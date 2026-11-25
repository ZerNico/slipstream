/**
 * The HLS routes (PLAN section 7). They sit outside the JSON API because players cannot send
 * auth headers: every request carries a `token` query parameter signed for its playlist or
 * capture, and segment files are served with byte-range support. A token only opens its window
 * of time, and lives only as long as the sign-in that asked for it: every playlist request
 * checks that the sign-in still holds and its user still sees the channel or recording, and
 * every segment request that the sign-in still holds. Segment access needs no lookup of its own:
 * a segment token opens only its playlist's window, which for live ends a few target durations
 * past the live edge and moves on with every playlist reload. Live playlists and their segments also
 * carry the playback `session`, and every such request keeps that viewer's hold on the capture
 * alive (a viewer that stops fetching is released after the idle timeout).
 *
 * A session that converts (`transcode/`) gets its playlists one directory deeper, named by its
 * variant (`/hls/live/<channel>/<variant>.m3u8`), and the variant travels in its signed tokens:
 * its segment links then serve the converted segment instead of the stored one.
 */
import { stat } from "node:fs/promises";
import { Cause, Clock, Effect, Layer, Schedule, Stream } from "effect";
import { HttpPlatform, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { type HlsGrant, Signing } from "../auth/signing.ts";
import { EventBus } from "../events.ts";
import { Hls, insideWindow, parseByteRange, scopes } from "../hls/service.ts";
import { type HlsTarget, Playback } from "../playback/service.ts";
import { atLiveEdge, liveStream, Transcoder } from "../transcode/service.ts";
import { parseVariant } from "../transcode/variant.ts";

const playlistHeaders = {
  "content-type": "application/vnd.apple.mpegurl",
  // Live and EVENT playlists change every few seconds.
  "cache-control": "no-cache, no-store",
};

const notFound = HttpServerResponse.text("Not found", { status: 404 });
const forbidden = HttpServerResponse.text("Forbidden", { status: 403 });
const unavailable = HttpServerResponse.text("Could not convert this segment", {
  status: 503,
  headers: { "retry-after": "1" },
});

const queryParam = (name: string) =>
  HttpServerRequest.HttpServerRequest.use((request) =>
    Effect.succeed(new URL(request.url, "http://localhost").searchParams.get(name) ?? ""),
  );

/**
 * How long a live playlist request waits for a starting capture's first segment. Acquiring a
 * live session starts ffmpeg, and the first segment lands about one segment length later;
 * players give up after a few quick 404s, so the request holds instead (like an LL-HLS
 * blocking reload) until the segment index stores one, and answers 404 only if none arrives.
 */
const FIRST_SEGMENT_WAIT = "20 seconds";
/** How often a waiting live playlist request tells playback its viewer is still there. */
const KEEP_WATCHING_EVERY = "1 second";

/** How soon converting ahead starts again after its loop failed. */
const CONVERT_AHEAD_RESTART = Schedule.min([
  Schedule.exponential("1 second"),
  Schedule.spaced("1 minute"),
]);

/**
 * Runs `convert` for every channel in `indexed` for as long as the server runs: one failing
 * (the database, a file) is logged and the next goes on, and the loop itself starts again
 * (`restart`) if its stream fails.
 */
export const keepConvertingAhead = (
  indexed: Stream.Stream<string>,
  convert: (channelId: string) => Effect.Effect<void>,
  restart: Schedule.Schedule<unknown> = CONVERT_AHEAD_RESTART,
): Effect.Effect<void> =>
  indexed.pipe(
    Stream.runForEach((channelId) =>
      convert(channelId).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("Could not convert a live segment ahead", cause).pipe(
                Effect.annotateLogs({ channelId }),
              ),
        ),
      ),
    ),
    Effect.sandbox,
    Effect.tapError((cause) =>
      Effect.logError("Converting live segments ahead stopped; starting it again", cause),
    ),
    Effect.retry({ schedule: restart, while: (cause) => !Cause.hasInterruptsOnly(cause) }),
    Effect.catchCause(() => Effect.void),
  );

const routeParam = (name: string) => Effect.map(HttpRouter.params, (params) => params[name] ?? "");

/** The variant a playlist route names; `undefined` on the original's routes. */
const routeVariant = Effect.map(HttpRouter.params, (params) => params["variant"]);

const playlist = (body: string | undefined) =>
  body === undefined ? notFound : HttpServerResponse.text(body, { headers: playlistHeaders });

/** Serves a file, honouring a single `Range: bytes=` request. */
const serveFile = (path: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const platform = yield* HttpPlatform.HttpPlatform;
    const info = yield* Effect.promise(() => stat(path).catch(() => undefined));
    if (info === undefined || !info.isFile()) return notFound;
    const headers = {
      "content-type": "video/mp2t",
      "accept-ranges": "bytes",
      // Segments never change once written; the token in the URL keeps them private.
      "cache-control": "private, max-age=86400, immutable",
    };
    const range = parseByteRange(request.headers["range"], info.size);
    if (range === "unsatisfiable") {
      return HttpServerResponse.empty({
        status: 416,
        headers: { "content-range": `bytes */${info.size}` },
      });
    }
    if (range === undefined) {
      return HttpServerResponse.setHeaders(
        yield* Effect.orDie(platform.fileResponse(path)),
        headers,
      );
    }
    const response = yield* Effect.orDie(
      platform.fileResponse(path, {
        status: 206,
        offset: range.start,
        bytesToRead: range.end - range.start + 1,
      }),
    );
    return HttpServerResponse.setHeaders(response, {
      ...headers,
      "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
    });
  });

/** Registers `/hls/live`, `/hls/recordings`, `/hls/range` and `/hls/seg`. */
export const HlsRoutes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const hls = yield* Hls;
    const signing = yield* Signing;
    const playback = yield* Playback;
    const transcoder = yield* Transcoder;
    const bus = yield* EventBus;

    /**
     * Tells playback that the request's live session (`session` query parameter) is still
     * watching, so its capture is not released as idle. Returns the session id for links.
     */
    const stillWatching = (userId: string) =>
      Effect.gen(function* () {
        const sessionId = yield* queryParam("session");
        if (sessionId === "") return undefined;
        yield* playback.touch(sessionId, userId);
        return sessionId;
      });

    /** The grant in the request's token if it is valid for `scope`. */
    const verify = (scope: string) =>
      Effect.flatMap(queryParam("token"), (token) =>
        Effect.map(signing.verifyHls(token), (grant) =>
          grant !== undefined && grant.s === scope ? grant : undefined,
        ),
      );

    /**
     * A playlist's grant: valid for `scope` and for the route's variant (the original's routes
     * only open grants without one), and its sign-in may still see `target`.
     */
    const authorise = (scope: string, target: HlsTarget) =>
      Effect.gen(function* () {
        const grant = yield* verify(scope);
        if (grant === undefined || grant.x !== (yield* routeVariant)) return undefined;
        return (yield* playback.admits(grant, target)) ? grant : undefined;
      });

    /**
     * The converted segment for a grant's variant; `undefined` when it cannot be had. `live`:
     * the request comes from a live playlist (its session rides along).
     */
    const converted = (
      grant: typeof HlsGrant.Type,
      captureId: string,
      sequence: number,
      segment: {
        readonly file: string;
        readonly runId: string;
        readonly startMs: number;
        readonly durationMs: number;
      },
      live: boolean,
    ) =>
      Effect.gen(function* () {
        const name = grant.x ?? "";
        const variant = parseVariant(name);
        if (variant === undefined) return undefined;
        const request = {
          name,
          variant,
          captureId,
          sequence,
          file: segment.file,
          lookback: yield* hls.sameRunFile(captureId, sequence - 1, segment.runId),
        };
        // At the live edge everyone watching the channel the same way shares the conversion;
        // anywhere else (a recording, a range, live behind the edge) the session has its own.
        const liveEdgeOf =
          live && grant.c !== undefined && atLiveEdge(segment, yield* Clock.currentTimeMillis)
            ? grant.c
            : undefined;
        const stream =
          liveEdgeOf !== undefined
            ? liveStream(liveEdgeOf)
            : (grant.k ?? (grant.c === undefined ? undefined : liveStream(grant.c)));
        const file = yield* transcoder.segment(
          request,
          stream === undefined ? undefined : { stream, liveEdgeOf },
        );
        // A picture is slow to convert: the next segment starts while this one is sent.
        const next =
          variant.video._tag === "Encode"
            ? yield* hls.sameRunFile(captureId, sequence + 1, segment.runId)
            : undefined;
        if (next !== undefined) {
          yield* transcoder.warm({
            ...request,
            sequence: sequence + 1,
            file: next,
            lookback: segment.file,
          });
        }
        return file;
      });

    /**
     * Converts a channel's newest segment for every live conversion in use as soon as it is
     * indexed, so converted live playback keeps up with the live edge.
     */
    const convertAhead = (channelId: string) =>
      Effect.gen(function* () {
        const conversions = yield* transcoder.liveInUse(channelId);
        if (conversions.length === 0) return;
        const newest = yield* hls.newestSegment(channelId);
        if (newest === undefined) return;
        const segment = yield* hls.segmentFile(newest.captureId, newest.sequence);
        if (segment === undefined) return;
        const lookback = yield* hls.sameRunFile(
          newest.captureId,
          newest.sequence - 1,
          segment.runId,
        );
        for (const conversion of conversions) {
          yield* transcoder.warm({
            name: conversion.name,
            variant: conversion.variant,
            captureId: newest.captureId,
            sequence: newest.sequence,
            file: segment.file,
            lookback,
          });
        }
      });
    yield* keepConvertingAhead(bus.segmentsIndexed, convertAhead).pipe(Effect.forkScoped);

    const live = Effect.gen(function* () {
      const channelId = yield* routeParam("channelId");
      const grant = yield* authorise(scopes.live(channelId), { _tag: "Channel", channelId });
      if (grant === undefined) return forbidden;
      const attempt = Effect.flatMap(stillWatching(grant.u), (sessionId) =>
        hls.live(channelId, grant, sessionId),
      );
      // A player waiting for the first segment is watching, so its hold on the capture
      // stays fresh (in memory) while it waits.
      const keepWatching = stillWatching(grant.u).pipe(
        Effect.repeat(Schedule.spaced(KEEP_WATCHING_EVERY)),
      );
      const body = yield* Effect.scoped(
        Effect.gen(function* () {
          const nextSegment = yield* bus.nextSegment(channelId);
          const first = yield* attempt;
          if (first !== undefined) return first;
          yield* Effect.timeoutOption(
            Effect.raceFirst(nextSegment, keepWatching),
            FIRST_SEGMENT_WAIT,
          );
          return yield* attempt;
        }),
      );
      return playlist(body);
    });

    const recording = Effect.gen(function* () {
      const recordingId = yield* routeParam("recordingId");
      const grant = yield* authorise(scopes.recording(recordingId), {
        _tag: "Recording",
        recordingId,
      });
      if (grant === undefined) return forbidden;
      return playlist(yield* hls.recording(recordingId, grant));
    });

    const range = Effect.gen(function* () {
      const channelId = yield* routeParam("channelId");
      const from = Number(yield* queryParam("from"));
      const to = Number(yield* queryParam("to"));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return HttpServerResponse.text("from and to must be epoch milliseconds, from before to", {
          status: 400,
        });
      }
      // The token names its range: another from or to is another (unsigned) scope.
      const grant = yield* authorise(scopes.range(channelId, from, to), {
        _tag: "Channel",
        channelId,
      });
      if (grant === undefined) return forbidden;
      return playlist(yield* hls.range(channelId, from, to, grant));
    });

    yield* router.addAll([
      HttpRouter.route("GET", "/hls/live/:channelId.m3u8", live),
      HttpRouter.route("GET", "/hls/live/:channelId/:variant.m3u8", live),
      HttpRouter.route("GET", "/hls/recordings/:recordingId.m3u8", recording),
      HttpRouter.route("GET", "/hls/recordings/:recordingId/:variant.m3u8", recording),
      HttpRouter.route("GET", "/hls/range/:channelId.m3u8", range),
      HttpRouter.route("GET", "/hls/range/:channelId/:variant.m3u8", range),
      HttpRouter.route(
        "GET",
        "/hls/seg/:captureId/:sequence.ts",
        Effect.gen(function* () {
          const captureId = yield* routeParam("captureId");
          const grant = yield* verify(scopes.capture(captureId));
          if (grant === undefined || !(yield* playback.signedIn(grant))) return forbidden;
          const sequence = Number(yield* routeParam("sequence"));
          if (!Number.isInteger(sequence) || sequence < 0) return notFound;
          const segment = yield* hls.segmentFile(captureId, sequence);
          if (segment === undefined) return notFound;
          // A segment token opens only the window of the playlist that linked it.
          if (!insideWindow(grant, segment)) return forbidden;
          const liveSession = yield* stillWatching(grant.u);
          if (grant.x === undefined) return yield* serveFile(segment.file);
          const file = yield* converted(
            grant,
            captureId,
            sequence,
            segment,
            liveSession !== undefined,
          );
          // The player retries a segment that could not be converted this time.
          return file === undefined ? unavailable : yield* serveFile(file);
        }),
      ),
    ]);
  }),
);
