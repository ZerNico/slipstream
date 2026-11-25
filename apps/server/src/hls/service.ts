/**
 * HLS playlists generated per request from the segment index (PLAN section 4), using the pure
 * playlist functions of `@slipstream/recorder`:
 *
 * - live: a sliding window over the channel's segments across captures (pause and rewind), as
 *   deep as the recorder's DVR window (which the disk guard shrinks when space runs low);
 * - recording: `EVENT` while its range is still being written, `VOD` once it is over;
 * - range: any captured stretch of a channel (start over).
 *
 * Every playlist covers a time window, and so does every segment link: segment links are relative
 * (`../seg/<capture>/<sequence>.ts`) so the server works under any path prefix, and each carries
 * a token for its capture, limited to the playlist's window, that expires with the playlist's. A
 * live playlist's window ends a few target durations past the live edge
 * (`LIVE_GRANT_TARGETS`), so access to a channel is checked again at least that often.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { isAnchor } from "@slipstream/domain";
import { recordingPlaylist, type Segment } from "@slipstream/recorder";
import { HlsGrant, Signing } from "../auth/signing.ts";
import { channelSegments } from "../captures/segments.ts";
import { Db } from "../db/client.ts";
import { captures, segments } from "../db/schema.ts";
import { Recorder } from "../recorder/engine.ts";
import { loadRecording, retainedRange } from "../recordings/store.ts";
import { channelLivePlaylist } from "./live.ts";

/**
 * How long playlist and segment tokens stay valid. Clients refresh a longer session through
 * `PATCH /api/playback/sessions/:id`, which answers with a new playlist URL.
 */
export const HLS_TOKEN_MILLIS = 3_600_000;
/** A range counts as fully written this long after it ended (the last segment needs flushing). */
const SETTLE_MILLIS = 15_000;
/**
 * How many target durations past the live edge a live playlist's segment links reach. A player
 * reloads a live playlist about once per target duration and gets fresh links each time, so the
 * window always covers what it fetches next, while a sign-in that lost the channel stops getting
 * new segments within it: its playlist requests are refused (`admits`) and its old links open
 * nothing that starts later.
 */
export const LIVE_GRANT_TARGETS = 3;

/** Playlist kinds and the token scope each needs. */
export const scopes = {
  live: (channelId: string) => `live:${channelId}`,
  /** A range token opens exactly the range it was signed for. */
  range: (channelId: string, fromMs: number, toMs: number) =>
    `range:${channelId}:${fromMs}:${toMs}`,
  recording: (recordingId: string) => `rec:${recordingId}`,
  capture: (captureId: string) => `cap:${captureId}`,
};

/** A time window in epoch ms. */
export interface Window {
  readonly fromMs: number;
  readonly toMs: number;
}

/** Whether a segment overlaps a grant's window (grants without one open nothing). */
export const insideWindow = (
  grant: typeof HlsGrant.Type,
  segment: { readonly startMs: number; readonly durationMs: number },
): boolean =>
  grant.from !== undefined &&
  segment.startMs + segment.durationMs > grant.from &&
  (grant.to === undefined || segment.startMs < grant.to);

const makeHls = Effect.gen(function* () {
  const { read, write } = yield* Db;
  const signing = yield* Signing;
  const recorder = yield* Recorder;

  /**
   * Segment URIs carrying a capture token limited to `window` that expires with the playlist
   * token and dies with its sign-in, plus the live session id when there is one (so segment
   * fetches count as the viewer still watching). A converting playlist's tokens carry its
   * variant and playback session too, and the playlist sits one directory deeper
   * (`<kind>/<id>/<variant>.m3u8`).
   */
  const segmentUri = (grant: typeof HlsGrant.Type, window: Window, sessionId?: string) => {
    const session = sessionId === undefined ? "" : `session=${encodeURIComponent(sessionId)}&`;
    const up = grant.x === undefined ? "../" : "../../";
    const tokens = new Map<string, string>();
    return (segment: Segment) => {
      let token = tokens.get(segment.captureId);
      if (token === undefined) {
        token = signing.signGrant({
          u: grant.u,
          s: scopes.capture(segment.captureId),
          exp: grant.exp,
          ...(grant.sid === undefined ? {} : { sid: grant.sid }),
          ...(grant.x === undefined ? {} : { x: grant.x }),
          ...(grant.c === undefined ? {} : { c: grant.c }),
          from: window.fromMs,
          to: window.toMs,
        });
        tokens.set(segment.captureId, token);
      }
      return `${up}seg/${encodeURIComponent(segment.captureId)}/${segment.sequence}.ts?${session}token=${token}`;
    };
  };

  /**
   * The live playlist of a channel: its segments of the last DVR window across captures;
   * `undefined` before any segment exists in it.
   */
  const live = (channelId: string, grant: typeof HlsGrant.Type, sessionId?: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const dvrWindowMs = yield* recorder.dvrWindowMs;
      return yield* channelLivePlaylist(write, {
        channelId,
        now,
        dvrWindowMs,
        segmentUri: (targetSeconds) =>
          segmentUri(
            grant,
            { fromMs: now - dvrWindowMs, toMs: now + LIVE_GRANT_TARGETS * targetSeconds * 1000 },
            sessionId,
          ),
      });
    });

  /**
   * A recording's playlist: its retained range, cut to the window its grant carries (a
   * recording extended after the grant was signed needs a refreshed session to play on).
   */
  const recording = (recordingId: string, grant: typeof HlsGrant.Type) =>
    Effect.gen(function* () {
      const stored = yield* loadRecording(read, recordingId);
      // An anchor was deleted by a person; its row only holds its chain's search (§3.7).
      if (stored === undefined || isAnchor(stored.recording)) return undefined;
      const retained = retainedRange(stored);
      const range = {
        startMs: Math.max(retained.startMs, grant.from ?? retained.startMs),
        endMs: Math.min(retained.endMs, grant.to ?? retained.endMs),
      };
      if (range.endMs <= range.startMs) return undefined;
      const now = yield* Clock.currentTimeMillis;
      const list = yield* channelSegments(
        read,
        stored.recording.channelId,
        range.startMs,
        range.endMs,
      );
      const running =
        stored.recording.state === "scheduled" || stored.recording.state === "recording";
      return recordingPlaylist(list, {
        fromMs: range.startMs,
        toMs: range.endMs,
        complete: !running || now >= range.endMs + SETTLE_MILLIS,
        segmentUri: segmentUri(grant, { fromMs: range.startMs, toMs: range.endMs }),
      });
    });

  /**
   * A range's playlist: the range asked for, cut to the window its grant carries (a
   * collection-limited viewer's grant starts no earlier than its DVR window).
   */
  const range = (channelId: string, fromMs: number, toMs: number, grant: typeof HlsGrant.Type) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const window = {
        fromMs: Math.max(fromMs, grant.from ?? fromMs),
        toMs: Math.min(toMs, grant.to ?? toMs),
      };
      const list =
        window.toMs > window.fromMs
          ? yield* channelSegments(read, channelId, window.fromMs, window.toMs)
          : [];
      return recordingPlaylist(list, {
        ...window,
        complete: now >= toMs + SETTLE_MILLIS,
        segmentUri: segmentUri(grant, window),
      });
    });

  /**
   * One indexed segment: its file (if inside its capture directory), when it plays and the
   * capture run that wrote it.
   */
  const segmentFile = (captureId: string, sequence: number) =>
    Effect.gen(function* () {
      const [row] = yield* read
        .select({
          path: segments.path,
          startMs: segments.startMs,
          durationMs: segments.durationMs,
          runId: segments.runId,
          directory: captures.directory,
        })
        .from(segments)
        .innerJoin(captures, eq(captures.id, segments.captureId))
        .where(and(eq(segments.captureId, captureId), eq(segments.sequence, sequence)))
        .pipe(Effect.orDie);
      if (row === undefined) return undefined;
      const file = resolve(row.directory, row.path);
      const inside = relative(resolve(row.directory), file);
      if (inside.startsWith("..") || isAbsolute(inside)) return undefined;
      return { file, startMs: row.startMs, durationMs: row.durationMs, runId: row.runId };
    });

  /**
   * The file of the segment at `sequence` when the same run wrote it (its timestamps continue
   * the neighbour's): the previous one warms up a conversion, the next one is converted ahead.
   */
  const sameRunFile = (captureId: string, sequence: number, runId: string) =>
    sequence < 0
      ? Effect.succeed(undefined)
      : Effect.map(segmentFile(captureId, sequence), (segment) =>
          segment?.runId === runId ? segment.file : undefined,
        );

  /** The newest indexed segment of a channel, for converting the live edge ahead. */
  const newestSegment = (channelId: string) =>
    read
      .select({ captureId: segments.captureId, sequence: segments.sequence })
      .from(segments)
      .innerJoin(captures, eq(captures.id, segments.captureId))
      .where(eq(captures.channelId, channelId))
      .orderBy(desc(segments.startMs))
      .limit(1)
      .pipe(
        Effect.map((rows) => rows[0]),
        Effect.orDie,
      );

  return { live, recording, range, segmentFile, sameRunFile, newestSegment };
});

/** HLS playlists and segment lookup. */
export class Hls extends Context.Service<Hls, Effect.Success<typeof makeHls>>()(
  "@slipstream/server/Hls",
) {
  static readonly layer = Layer.effect(Hls, makeHls);
}

/** A parsed single `Range: bytes=` header. Multiple ranges are not supported (served whole). */
export type ByteRange =
  | { readonly start: number; readonly end: number }
  | "unsatisfiable"
  | undefined;

/**
 * Parses `Range: bytes=a-b`, `bytes=a-` and `bytes=-n` against a file size. Returns `undefined`
 * for anything to ignore (absent, malformed, several ranges), which means "send it all".
 */
export const parseByteRange = (header: string | undefined, size: number): ByteRange => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (match === null) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? undefined : { start, end };
};
