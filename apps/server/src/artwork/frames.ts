/**
 * Frame grabs for artwork (SPEC 7.4, PLAN 6.6): one JPEG per recording, taken from its segments
 * at `frameMoment` (10 minutes into the programme, the middle of short ones), never from the
 * extra time. Black frames are skipped: ffmpeg samples the window twice a second and keeps the
 * first picture whose average brightness clears a floor. A window with nothing but black counts
 * as a failed attempt, and the next attempt looks two minutes later.
 *
 * Frames live in `<dataDir>/frames/<recordingId>.jpg`; the recording row keeps the moment it
 * shows (`frame_at`) and how often grabbing failed (`frame_failures`).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Layer, Schedule } from "effect";
import { frameDue, frameMoment, playableStates } from "@slipstream/domain";
import { FfmpegRunner } from "@slipstream/recorder";
import { ServerConfig } from "../config.ts";
import { overlapping } from "../captures/segments.ts";
import { Db } from "../db/client.ts";
import { toInstant } from "../db/codec.ts";
import { captures, recordings, segments } from "../db/schema.ts";

/** How long a grab window is: the frame is the first non-black picture in it. */
export const FRAME_WINDOW_MILLIS = 60_000;
/** How much later each new attempt looks, after a window with only black pictures. */
export const FRAME_RETRY_STEP_MILLIS = 2 * 60_000;
/** Attempts per recording before it keeps its guide or generated artwork for good. */
export const MAX_FRAME_FAILURES = 3;
/** How often the grabber looks for recordings that are due. */
const GRAB_INTERVAL = Duration.seconds(30);
/** Average luma (0 to 255) a picture needs to count as not black. */
const BLACK_FLOOR = 24;

/** Where a recording's frame is stored. */
export const framePath = (dataDir: string, recordingId: string): string =>
  join(dataDir, "frames", `${recordingId}.jpg`);

/** The start of the window an attempt looks at, epoch ms. */
export const frameWindowStart = (
  programme: { readonly start: DateTime.Utc; readonly end: DateTime.Utc },
  failures: number,
): number => DateTime.toEpochMillis(frameMoment(programme)) + failures * FRAME_RETRY_STEP_MILLIS;

/** A stored segment, with the directory of its capture. */
export interface FrameSegment {
  readonly startMs: number;
  readonly durationMs: number;
  readonly file: string;
}

/**
 * The ffmpeg arguments that write the first non-black picture of `[fromMs, fromMs + window)` to
 * `output`, from consecutive segments (MPEG-TS joins with the concat protocol). Pictures are
 * sampled twice a second and scaled to 640 pixels wide.
 */
export const frameGrabArgs = (
  parts: ReadonlyArray<FrameSegment>,
  fromMs: number,
  output: string,
): Array<string> => {
  const first = parts[0];
  const offsetSeconds = first === undefined ? 0 : Math.max(0, fromMs - first.startMs) / 1000;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    offsetSeconds.toFixed(3),
    "-t",
    String(FRAME_WINDOW_MILLIS / 1000),
    "-i",
    `concat:${parts.map((part) => part.file).join("|")}`,
    "-an",
    "-vf",
    `fps=2,signalstats,metadata=mode=select:key=lavfi.signalstats.YAVG:value=${BLACK_FLOOR}:function=greater,scale=640:-2`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    "-f",
    "image2",
    "-y",
    output,
  ];
};

/**
 * Grabs the first non-black picture of the window into `output`. Succeeds with `true` when a
 * picture was written, `false` when the window held only black (or ffmpeg failed).
 */
const grabFrame = (
  parts: ReadonlyArray<FrameSegment>,
  fromMs: number,
  output: string,
): Effect.Effect<boolean, never, FfmpegRunner> =>
  Effect.gen(function* () {
    if (parts.length === 0) return false;
    const ffmpeg = yield* FfmpegRunner;
    const partial = `${output}.part`;
    rmSync(partial, { force: true });
    const ran = yield* ffmpeg
      .run(frameGrabArgs(parts, fromMs, partial), { timeout: Duration.seconds(30) })
      .pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    if (!ran || !existsSync(partial) || statSync(partial).size === 0) {
      rmSync(partial, { force: true });
      return false;
    }
    renameSync(partial, output);
    return true;
  });

/**
 * Grabs frames for every recording that is due: holding segments past its frame window and not
 * given up on. Removes frames of recordings that no longer exist.
 */
export const grabDueFrames = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const config = yield* ServerConfig;
  const dir = join(config.dataDir, "frames");
  mkdirSync(dir, { recursive: true });
  const candidates = yield* read
    .select({
      id: recordings.id,
      channelId: recordings.channelId,
      start: recordings.start,
      end: recordings.end,
      state: recordings.state,
      failures: recordings.frameFailures,
    })
    .from(recordings)
    .where(
      and(
        inArray(recordings.state, [...playableStates]),
        isNull(recordings.frameAt),
        lt(recordings.frameFailures, MAX_FRAME_FAILURES),
      ),
    )
    .pipe(Effect.orDie);
  for (const candidate of candidates) {
    const programme = { start: toInstant(candidate.start), end: toInstant(candidate.end) };
    const fromMs = frameWindowStart(programme, candidate.failures);
    const toMs = fromMs + FRAME_WINDOW_MILLIS;
    const parts = yield* read
      .select({
        startMs: segments.startMs,
        durationMs: segments.durationMs,
        path: segments.path,
        directory: captures.directory,
      })
      .from(segments)
      .innerJoin(captures, eq(captures.id, segments.captureId))
      .where(overlapping(candidate.channelId, fromMs, toMs))
      .orderBy(segments.startMs)
      .pipe(Effect.orDie);
    const capturedUntil = parts.reduce(
      (latest, part) => Math.max(latest, part.startMs + part.durationMs),
      0,
    );
    const finished = candidate.state !== "recording";
    // A running recording waits until the whole window is captured.
    const ready =
      frameDue(
        { ...programme, state: candidate.state },
        capturedUntil === 0 ? undefined : toInstant(capturedUntil),
      ) &&
      (finished || capturedUntil >= toMs);
    if (!ready && !finished) continue;
    const grabbed =
      ready &&
      (yield* grabFrame(
        parts.map((part) => ({
          startMs: part.startMs,
          durationMs: part.durationMs,
          file: join(part.directory, part.path),
        })),
        fromMs,
        framePath(config.dataDir, candidate.id),
      ));
    yield* write
      .update(recordings)
      .set(grabbed ? { frameAt: fromMs } : { frameFailures: sql`${recordings.frameFailures} + 1` })
      .where(eq(recordings.id, candidate.id))
      .pipe(Effect.orDie);
    if (grabbed) {
      yield* Effect.logDebug("Grabbed a frame").pipe(
        Effect.annotateLogs({ recording: candidate.id }),
      );
    }
  }
  // Frames of recordings retention or someone deleted.
  const files = readdirSync(dir).filter((name) => name.endsWith(".jpg"));
  if (files.length > 0) {
    const ids = files.map((name) => name.slice(0, -".jpg".length));
    const existing = new Set(
      (yield* read
        .select({ id: recordings.id })
        .from(recordings)
        .where(inArray(recordings.id, ids))
        .pipe(Effect.orDie)).map((row) => row.id),
    );
    for (const id of ids) {
      if (!existing.has(id)) rmSync(join(dir, `${id}.jpg`), { force: true });
    }
  }
});

/** Grabs due frames in the background for the server's lifetime. */
export const FrameGrabber = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Db;
    const config = yield* ServerConfig;
    const runner = yield* FfmpegRunner;
    yield* grabDueFrames.pipe(
      Effect.provideService(Db, db),
      Effect.provideService(ServerConfig, config),
      Effect.provideService(FfmpegRunner, runner),
      Effect.catchCause((cause) => Effect.logError("Grabbing frames failed", cause)),
      Effect.repeat(Schedule.spaced(GRAB_INTERVAL)),
      Effect.forkScoped,
    );
  }),
);
