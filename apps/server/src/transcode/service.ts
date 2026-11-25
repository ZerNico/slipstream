/**
 * Playback conversion (PLAN 6.11): converts stored segments for a variant on request (`args.ts`
 * says how, per segment), shares the work between viewers, caches it briefly and bounds how
 * much converting runs at once.
 *
 * - **Shared.** A converted segment is keyed by its source segment (capture and sequence) and
 *   the variant (the output profile: video copy or codec, size, bitrate, deinterlacing; audio
 *   copy or AAC with its track, channels and bitrate). Everyone who needs the same key gets the
 *   same file: from the cache, or by waiting for the one ffmpeg already converting it
 *   (single flight). Two viewers of one channel in the same variant therefore cost one
 *   conversion; another variant is another conversion.
 * - **Stops when nobody waits.** A job runs in the service's scope and counts the requests
 *   waiting for it; when the last one goes away (the player moved on, closed, seeked), the job
 *   is interrupted and its ffmpeg killed. Only the one-segment look-ahead (`warm`) runs to the
 *   end without a waiter. Shutdown kills every ffmpeg.
 * - **Cache.** `<data>/transcode/<variant>/<capture>/<sequence>.ts`, written under a temporary
 *   name and renamed when complete. A sweep deletes converted segments older than
 *   {@link CACHE_TTL_MILLIS}, those whose source segment is gone (retention or the disk guard
 *   purged it), and the oldest beyond {@link CACHE_MAX_BYTES}; startup deletes all of it.
 * - **Ahead.** A picture segment is slow to convert, so serving one starts the next one. Live
 *   conversions in use at the live edge (someone fetched a segment there, {@link atLiveEdge},
 *   within {@link LIVE_AHEAD_IDLE_MILLIS}) are also converted as each new segment is indexed
 *   (`liveInUse`, driven by the segment routes), so the converted live edge keeps up with the
 *   original's. A viewer paused or behind does not keep the live edge converting. Converting
 *   ahead never queues for a job slot: it runs on a free one or not at all, so it never holds
 *   up a segment someone waits for.
 * - **Bounded.** Audio jobs (cheap) run up to one per core. Picture jobs run up to
 *   {@link videoSessionLimit} at a time per encoder kind, and as many distinct picture
 *   conversions may be in use at once (`videoBusy`): what converts the same segments counts
 *   once (everyone watching a channel live at its edge in the same variant, `liveStream`), any
 *   other session counts on its own (`sessionStream`: a recording, a range, live behind the
 *   edge). A new one over the limit whose device plays the original picture gets the original
 *   (`withOriginalVideo` in the domain); one that cannot waits for a picture job.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, rmdir, stat, unlink } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Schedule,
  Semaphore,
} from "effect";
import { FfmpegRunner } from "@slipstream/recorder";
import { ServerConfig } from "../config.ts";
import { parseSegmentProbe, probeArgs, segmentArgs } from "./args.ts";
import type { Variant } from "./variant.ts";

/** How long a converted segment stays cached after it was written. */
export const CACHE_TTL_MILLIS = 10 * 60_000;
/** The most converted segments may take on disk; the oldest go first. */
export const CACHE_MAX_BYTES = 4 * 1024 ** 3;
/** How often the cache is swept. */
const SWEEP_EVERY = Duration.minutes(1);
/** A picture conversion counts as in use this long after its last segment was asked for. */
export const VIDEO_IDLE_MILLIS = 45_000;
/** A live conversion is converted ahead while someone fetched from it this recently. */
export const LIVE_AHEAD_IDLE_MILLIS = 30_000;
/** A segment counts as at the live edge when it ended at most this long ago (or six segments). */
export const LIVE_EDGE_MILLIS = 30_000;
/** An empty cache directory this young may be about to receive a conversion: the sweep keeps it. */
const DIRECTORY_GRACE_MILLIS = 60_000;
/** A segment job that takes longer than this is killed. */
const JOB_TIMEOUT = Duration.minutes(2);

/**
 * How many distinct picture conversions may be in use at once, and how many picture jobs run
 * at a time: four on a hardware encoder (consumer GPUs allow a handful of encode sessions),
 * else one per four cores (x264 spreads one job over several).
 */
export const videoSessionLimit = (hardware: boolean, cores: number): number =>
  hardware ? 4 : Math.max(1, Math.floor(cores / 4));

/** One segment to convert, as the segment route found it in the index. */
export interface SegmentRequest {
  /** The variant's name (`variantName`), and what it stands for. */
  readonly name: string;
  readonly variant: Variant;
  readonly captureId: string;
  readonly sequence: number;
  /** The stored segment file. */
  readonly file: string;
  /** The previous segment of the same run, for warm-up and open GOPs. */
  readonly lookback?: string | undefined;
}

/** A conversion running for one key, and how many requests wait for it. */
interface Job {
  /** The converted file it writes. */
  readonly output: string;
  readonly done: Deferred.Deferred<string | undefined>;
  fiber: Fiber.Fiber<unknown> | undefined;
  waiters: number;
  /**
   * A look-ahead on a free job slot: it runs to the end even when nobody waits. A job that
   * queues for a slot never is: it stops when its last waiter leaves.
   */
  pinned: boolean;
  /** A look-ahead that found no free job slot and gave up: a waiter converts afresh. */
  skipped: boolean;
}

/** Whether a variant converts the picture. */
const convertsVideo = (variant: Variant): boolean => variant.video._tag === "Encode";

/** The picture conversion everyone watching `channelId` live at its edge shares. */
export const liveStream = (channelId: string): string => `live:${channelId}`;
/**
 * The picture conversion of one playback session on its own: a recording or a range (each
 * viewer at their own position), or live played behind the edge.
 */
export const sessionStream = (sessionId: string): string => `session:${sessionId}`;

/** The key of a picture conversion in use: what it converts (`liveStream`, `sessionStream`) and how. */
export const conversionKey = (stream: string, variant: string): string => `${stream}/${variant}`;

/**
 * Whether a segment is at the live edge: it ended at most {@link LIVE_EDGE_MILLIS} (or six
 * segment lengths) before `now`. Players sit a few segments behind the newest one.
 */
export const atLiveEdge = (
  segment: { readonly startMs: number; readonly durationMs: number },
  now: number,
): boolean =>
  segment.startMs + segment.durationMs >= now - Math.max(LIVE_EDGE_MILLIS, 6 * segment.durationMs);

/**
 * Who asks for a converted segment: the picture conversion it counts for (`liveStream` or
 * `sessionStream`), and the channel whose live edge it plays at, if it does (its new segments
 * are then converted ahead).
 */
export interface Requester {
  readonly stream: string;
  readonly liveEdgeOf: string | undefined;
}

/** A live conversion in use, for converting new segments ahead. */
interface LiveConversion {
  readonly name: string;
  readonly variant: Variant;
  readonly seen: number;
}

const exists = (path: string) =>
  Effect.promise(() =>
    stat(path).then(
      (info) => info.isFile(),
      () => false,
    ),
  );

const makeTranscoder = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const runner = yield* FfmpegRunner;
  const scope = yield* Effect.scope;
  const root = join(config.dataDir, "transcode");
  const cores = availableParallelism();

  // Nothing cached survives a restart: the variants or the segments may have changed.
  yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
  yield* Effect.promise(() => mkdir(root, { recursive: true }));

  const audioJobs = yield* Semaphore.make(Math.max(2, cores));
  const hardwareJobs = yield* Semaphore.make(videoSessionLimit(true, cores));
  const softwareJobs = yield* Semaphore.make(videoSessionLimit(false, cores));
  const jobs = new Map<string, Job>();
  /** The source segment of each converted file, so the sweep sees when it was purged. */
  const sources = new Map<string, string>();
  /** Picture conversions in use (`conversionKey`), by when a segment was last asked for. */
  const inUse = yield* Ref.make(new Map<string, number>());
  /** Live conversions in use per channel, by variant name. */
  const live = yield* Ref.make(new Map<string, ReadonlyMap<string, LiveConversion>>());

  const permits = (variant: Variant) =>
    variant.video._tag !== "Encode"
      ? audioJobs
      : variant.video.encoder === "software"
        ? softwareJobs
        : hardwareJobs;

  /** Probes and converts one segment into `output`; `undefined` when ffmpeg failed. */
  const convert = (request: SegmentRequest, output: string) =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis;
      const audioTrack =
        request.variant.audio._tag === "Encode" ? request.variant.audio.trackIndex : 0;
      const probed = yield* runner.run(probeArgs(request.file), {
        binary: "ffprobe",
        timeout: Duration.seconds(20),
      });
      const partial = `${output}.${randomUUID()}.part`;
      yield* Effect.promise(() => mkdir(dirname(output), { recursive: true }));
      yield* (
        runner
          .run(
            segmentArgs({
              segment: request.file,
              lookback: request.lookback,
              variant: request.variant,
              probe: parseSegmentProbe(probed.stdout, audioTrack),
              output: partial,
            }),
            { timeout: JOB_TIMEOUT },
          )
          // Failed or interrupted: no half-written file stays behind.
          .pipe(Effect.onError(() => Effect.promise(() => rm(partial, { force: true }))))
      );
      // Known before it appears, so the sweep never takes it for one whose source is gone.
      sources.set(output, request.file);
      const renamed = yield* Effect.promise(() =>
        rename(partial, output).then(
          () => true,
          () => false,
        ),
      );
      if (!renamed && !(yield* exists(output))) sources.delete(output);
      const took = (yield* Clock.currentTimeMillis) - started;
      yield* Effect.logDebug("Converted a segment").pipe(
        Effect.annotateLogs({ variant: request.name, sequence: request.sequence, millis: took }),
      );
      return (yield* exists(output)) ? output : undefined;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not convert a segment", cause).pipe(
          Effect.annotateLogs({
            variant: request.name,
            captureId: request.captureId,
            sequence: request.sequence,
          }),
          Effect.as(undefined),
        ),
      ),
    );

  /**
   * Waits for a job as one of its waiters; the last waiter to leave stops it. A job being
   * stopped is forgotten at once, so a request in the meantime converts afresh instead of
   * waiting for one that is going away.
   */
  const waitFor = (job: Job) =>
    Effect.suspend(() => {
      job.waiters += 1;
      return Deferred.await(job.done);
    }).pipe(
      Effect.onExit(() =>
        Effect.suspend(() => {
          job.waiters -= 1;
          const fiber = job.fiber;
          if (job.waiters > 0 || job.pinned || fiber === undefined) return Effect.void;
          if (jobs.get(job.output) === job) jobs.delete(job.output);
          return Effect.asVoid(Effect.forkIn(Fiber.interrupt(fiber), scope));
        }),
      ),
    );

  /**
   * Starts converting into `output`. A look-ahead (`pinned`) takes a job slot only when one is
   * free right now: segments someone waits for queue for slots, a look-ahead never does. One
   * that finds none gives up, unless a request joined it meanwhile: then it queues for that
   * request and stops when it leaves.
   */
  const start = (request: SegmentRequest, output: string, pinned: boolean) =>
    Effect.gen(function* () {
      // Made and registered in one step, so a second request cannot slip in between.
      const job: Job = {
        output,
        done: Deferred.makeUnsafe(),
        fiber: undefined,
        waiters: 0,
        pinned,
        skipped: false,
      };
      jobs.set(output, job);
      const slots = permits(request.variant);
      const queued = convert(request, output).pipe(slots.withPermits(1));
      const run = !pinned
        ? queued
        : Effect.uninterruptibleMask((restore) =>
            Effect.flatMap(slots.takeIfAvailable(1), (free) =>
              free
                ? restore(convert(request, output)).pipe(Effect.ensuring(slots.release(1)))
                : job.waiters > 0
                  ? // Someone wants it after all: it queues like theirs, and stops with them.
                    Effect.suspend(() => {
                      job.pinned = false;
                      return restore(queued);
                    })
                  : Effect.sync(() => {
                      job.skipped = true;
                      return undefined;
                    }),
            ),
          );
      job.fiber = yield* run.pipe(
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            if (jobs.get(output) === job) jobs.delete(output);
            return Deferred.done(job.done, Exit.isSuccess(exit) ? exit : Exit.succeed(undefined));
          }),
        ),
        Effect.forkIn(scope),
      );
      return job;
    });

  const outputOf = (request: SegmentRequest) =>
    join(root, request.name, request.captureId, `${request.sequence}.ts`);

  /** The converted file, converting it once however many ask at the same time. */
  const ensure = (request: SegmentRequest): Effect.Effect<string | undefined> =>
    Effect.gen(function* () {
      const output = outputOf(request);
      if (yield* exists(output)) return output;
      const job = jobs.get(output) ?? (yield* start(request, output, false));
      const file = yield* waitFor(job);
      // Joined a look-ahead that found no free slot: queue for one now.
      return job.skipped ? yield* ensure(request) : file;
    });

  /** Starts converting a segment ahead unless it is cached or converting already. */
  const ahead = (request: SegmentRequest) =>
    Effect.gen(function* () {
      const output = outputOf(request);
      if (yield* exists(output)) return;
      // Already converting for someone: it goes on as long as they wait.
      if (jobs.has(output)) return;
      yield* start(request, output, true);
    });

  /** Deletes old converted segments, those whose source is gone, and the oldest over the cap. */
  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const files: Array<{ path: string; mtimeMs: number; size: number }> = [];
    yield* Effect.promise(async () => {
      const walk = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            await walk(path);
            // A job may just have made it and not opened its file yet.
            const busy = [...jobs.keys()].some((output) => output.startsWith(`${path}/`));
            const made = await stat(path).then(
              (info) => info.mtimeMs,
              () => 0,
            );
            if (!busy && now - made > DIRECTORY_GRACE_MILLIS) {
              await rmdir(path).catch(() => undefined);
            }
            continue;
          }
          if (!entry.name.endsWith(".ts")) continue;
          const info = await stat(path).catch(() => undefined);
          if (info === undefined) continue;
          const source = sources.get(path);
          const purged =
            source === undefined ||
            (await stat(source).then(
              () => false,
              () => true,
            ));
          if (now - info.mtimeMs > CACHE_TTL_MILLIS || purged) {
            await unlink(path).catch(() => undefined);
            sources.delete(path);
          } else {
            files.push({ path, mtimeMs: info.mtimeMs, size: info.size });
          }
        }
      };
      await walk(root);
      let total = files.reduce((sum, file) => sum + file.size, 0);
      for (const file of files.toSorted((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (total <= CACHE_MAX_BYTES) break;
        await unlink(file.path).catch(() => undefined);
        sources.delete(file.path);
        total -= file.size;
      }
    });
  });
  yield* sweep.pipe(Effect.repeat(Schedule.spaced(SWEEP_EVERY)), Effect.forkScoped);

  /** Marks a picture conversion (`conversionKey`) as in use now. */
  const touchVideo = (key: string) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Ref.update(inUse, (map) => new Map(map).set(key, now)),
    );

  return {
    /**
     * The converted segment's file, converting it first unless it is cached or already
     * converting; `undefined` when conversion failed (the route answers 503 and the player
     * retries). The `requester` keeps its picture conversion counted as in use, and at the live
     * edge its channel's new segments converted ahead.
     */
    segment: (request: SegmentRequest, requester: Requester | undefined) =>
      Effect.gen(function* () {
        if (requester !== undefined) {
          if (convertsVideo(request.variant)) {
            yield* touchVideo(conversionKey(requester.stream, request.name));
          }
          const channelId = requester.liveEdgeOf;
          if (channelId !== undefined) {
            const now = yield* Clock.currentTimeMillis;
            yield* Ref.update(live, (map) => {
              const next = new Map(map);
              const variants = new Map(map.get(channelId));
              variants.set(request.name, {
                name: request.name,
                variant: request.variant,
                seen: now,
              });
              next.set(channelId, variants);
              return next;
            });
          }
        }
        return yield* ensure(request);
      }),
    /** The live conversions of a channel someone fetched from recently, to convert ahead. */
    liveInUse: (channelId: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const variants = (yield* Ref.get(live)).get(channelId);
        return [...(variants?.values() ?? [])].filter(
          (conversion) => now - conversion.seen < LIVE_AHEAD_IDLE_MILLIS,
        );
      }),
    /**
     * Starts converting a segment ahead in the background (the one after a picture segment, a
     * new live segment), on a free job slot only.
     */
    warm: ahead,
    /** Sweeps the cache now (it also runs every minute). */
    sweep,
    /** Counts a picture conversion as in use from now on. */
    touchVideo,
    /**
     * Whether as many other picture conversions as allowed are in use, so `key` should not
     * start another (`videoSessionLimit`). A conversion already in use is never busy: its
     * viewers share it.
     */
    videoBusy: (key: string, hardware: boolean) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const active = [...(yield* Ref.get(inUse))].filter(
          ([other, seen]) => now - seen < VIDEO_IDLE_MILLIS && other !== key,
        );
        const mine = (yield* Ref.get(inUse)).get(key);
        if (mine !== undefined && now - mine < VIDEO_IDLE_MILLIS) return false;
        return active.length >= videoSessionLimit(hardware, cores);
      }),
  };
});

/** Converts segments for sessions that cannot play the original. */
export class Transcoder extends Context.Service<
  Transcoder,
  Effect.Success<typeof makeTranscoder>
>()("@slipstream/server/Transcoder") {
  static readonly layer = Layer.effect(Transcoder, makeTranscoder);
}
