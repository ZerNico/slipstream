/**
 * Playback (PLAN 6.7, 6.11, section 7): sessions that hand out signed playlist URLs and hold a
 * live viewer's place on a capture, plus resume positions and continue watching per user.
 *
 * Each session runs the transcode decision (`decideTranscode`) over what ffprobe sees in the
 * stored segments, the client's capabilities and the detected hardware, and runs it again when
 * the client updates the session (catch-up speed, quality, throughput).
 *
 * Playlist tokens are short-lived (`HLS_TOKEN_MILLIS`), bound to the sign-in that asked for them
 * and to a time window: a range opens exactly its range, a recording its retained range, live
 * the DVR window. Every update answers with a fresh playlist URL, so a client keeps a long
 * session going by updating it before `expiresAt`. Every playlist request checks again that the
 * sign-in still holds and its user still sees what plays (`admits`).
 *
 * A session whose plan converts the audio or the picture gets a playlist for its conversion
 * variant (`transcode/variant.ts`): its segments are converted one by one as players fetch them
 * (`Transcoder`). Another plan on an update is another variant and so another playlist URL,
 * which players load afresh where they were. While as many sessions convert their picture as
 * the server allows, a new one whose device plays the original picture gets it
 * (`withOriginalVideo`, logged); one that cannot waits for the converter's picture jobs. A
 * remux-only plan never happens for the stored MPEG-TS segments and plays the original.
 *
 * The decision needs to know what the stream carries; a live session on a channel that was
 * never captured before waits for its first segment, so it does not start on the original
 * and stay there.
 */
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer, Option, Ref, Schedule } from "effect";
import {
  Forbidden,
  InvalidInput,
  NotFound,
  RangeNotCaptured,
  rangeMaxMillis,
  StreamLimitReached,
  type PlaybackProgress,
  type PlaybackSession,
  type PlaybackSessionRequest,
  type PlaybackSessionUpdate,
} from "@slipstream/api";
import { probe } from "@slipstream/recorder";
import {
  ChannelId,
  decideTranscode,
  type Instant,
  isAnchor,
  PlaybackSessionId,
  type PlaybackState,
  qualityRequest,
  qualitySituation,
  sessionQuality,
  type PlaybackTarget,
  ProgrammeId,
  RecordingId,
  softwareOnly,
  SourceId,
  type TimeRange,
  watchingVerdict,
  type TranscodePlan,
  type User,
  UserId,
  withOriginalVideo,
} from "@slipstream/domain";
import { EventBus } from "../events.ts";
import { conversionKey, liveStream, sessionStream, Transcoder } from "../transcode/service.ts";
import { variantName } from "../transcode/variant.ts";
import { Auth, type RequestOrigin } from "../auth/service.ts";
import { type HlsGrant, Signing } from "../auth/signing.ts";
import { ServerConfig } from "../config.ts";
import { overlapping } from "../captures/segments.ts";
import { Db } from "../db/client.ts";
import { readStreamInfo, storeStreamInfo, toInstant } from "../db/codec.ts";
import {
  captures,
  channels,
  channelStreams,
  playbackStates,
  programmes,
  recordings,
  segments,
  sources,
  sourceStreams,
} from "../db/schema.ts";
import {
  loadViewer,
  requireChannel,
  seesChannel,
  seesRecording,
  type Viewer,
} from "../household/viewer.ts";
import {
  loadRecording,
  retainedEndSql,
  retainedRange,
  retainedStartSql,
} from "../recordings/store.ts";
import { HLS_TOKEN_MILLIS, scopes } from "../hls/service.ts";
import { newId } from "../ids.ts";
import { Recorder } from "../recorder/engine.ts";
import { Settings } from "../settings/service.ts";
import { Hardware } from "../system/hardware.ts";
import { liveChannel, onLiveChannel } from "../channels/lineup.ts";

/** The sign-in a playback request comes from. */
export interface PlaybackClient {
  /** The session row behind the request's credential; playlist tokens live as long as it does. */
  readonly sessionId: string;
  /** The paired device it plays on ("Kitchen Shield"); absent for browsers. */
  readonly deviceName: string | undefined;
  /** Whether the request came from the home network or from away, for the default quality. */
  readonly origin: RequestOrigin;
}

/** What an HLS playlist request is for, as `admits` checks it. */
export type HlsTarget =
  | { readonly _tag: "Channel"; readonly channelId: string }
  | { readonly _tag: "Recording"; readonly recordingId: string };

/** What a session was asked to do, kept so updates can decide again. */
interface OpenSession {
  readonly userId: string;
  readonly request: PlaybackSessionRequest;
  readonly playlistUrl: string;
  readonly startAt: Instant | undefined;
  readonly expiresAt: Instant;
  readonly createdAt: number;
  /** The device it plays on ("Kitchen Shield"); absent for browsers. */
  readonly deviceName: string | undefined;
  /** Where the client last asked from: home or away picks the household's default quality. */
  readonly origin: RequestOrigin;
  /** How it is delivered, as last decided. */
  readonly decision: Decision;
}

/** A session's delivery: the plan the client sees, and the variant that converts it. */
interface Decision {
  readonly plan?: TranscodePlan;
  readonly variant?: string;
}

/** How long a new live session waits for the first segment of a channel never captured before. */
const FIRST_SEGMENT_WAIT = "20 seconds";
/** How often it looks for that segment in the index meanwhile. */
const FIRST_SEGMENT_POLL = "500 millis";

/** A live session as the streams overview lists it. */
export interface LiveSession {
  readonly id: string;
  readonly userId: string;
  readonly channelId: string;
  readonly createdAt: number;
  readonly deviceName: string | undefined;
}

/** One source a channel can be watched from, with its stream budget. */
export interface SourceBudget {
  readonly id: string;
  readonly maxStreams: number | null;
  readonly keptForRecordings: number | null;
}

/** Why a new live viewer does or does not fit. */
export type LiveVerdict =
  | { readonly _tag: "ok" }
  | { readonly _tag: "profileLimit" }
  | { readonly _tag: "sourceFull"; readonly sourceId: string | undefined };

/**
 * Whether a new live viewer of `channelId` fits (SPEC 7.9): the profile is under its own limit,
 * and either the channel's capture already runs (viewers share it) or one of its sources has a
 * stream left for watching. `streams` are the running channel captures.
 */
export const liveVerdict = (input: {
  readonly channelId: string;
  readonly sources: ReadonlyArray<SourceBudget>;
  readonly streams: ReadonlyArray<{
    readonly channelId: string;
    readonly sourceId: string | undefined;
    readonly consumers: ReadonlyArray<{ readonly kind: string }>;
  }>;
  readonly profileLimit: number | undefined;
  readonly profileWatching: number;
}): LiveVerdict => {
  const profile = { limit: input.profileLimit, watching: input.profileWatching };
  const none = { keptForRecordings: 0, recording: 0, watching: 0 };
  if (watchingVerdict(none, profile) === "profileLimit") return { _tag: "profileLimit" };
  if (input.streams.some((stream) => stream.channelId === input.channelId)) return { _tag: "ok" };
  if (input.sources.length === 0) return { _tag: "ok" };
  for (const source of input.sources) {
    const onSource = input.streams.filter((stream) => stream.sourceId === source.id);
    const recording = onSource.filter((stream) =>
      stream.consumers.some((consumer) => consumer.kind === "recording"),
    ).length;
    const verdict = watchingVerdict(
      {
        ...(source.maxStreams === null ? {} : { maxStreams: source.maxStreams }),
        keptForRecordings: source.keptForRecordings ?? 0,
        recording,
        watching: onSource.length - recording,
      },
      { watching: 0 },
    );
    if (verdict === "ok") return { _tag: "ok" };
  }
  return { _tag: "sourceFull", sourceId: input.sources[0]?.id };
};

/**
 * The picture conversion a new session counts for against the limit (`videoBusy`): live starts
 * at the edge, which everyone watching the channel the same way shares; a recording or a range
 * converts the segments at its own position, so it counts on its own.
 */
export const conversionStream = (
  source: PlaybackSessionRequest["source"],
  sessionId: string,
): string => (source._tag === "Live" ? liveStream(source.channelId) : sessionStream(sessionId));

const CONTINUE_LIMIT = 20;
/** How far past the server's clock a range may end: clients' clocks differ a little. */
const RANGE_END_SLACK_MILLIS = 5 * 60_000;

/**
 * Checks a range names a captured stretch: it ends after it starts, spans at most a day, and
 * has ended (a few minutes of clock difference allowed), so a token never opens the future.
 */
const checkRange = (range: TimeRange) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const start = DateTime.toEpochMillis(range.start);
    const end = DateTime.toEpochMillis(range.end);
    const code =
      end <= start
        ? "beforeStart"
        : end - start > rangeMaxMillis
          ? "rangeTooLong"
          : end > now + RANGE_END_SLACK_MILLIS
            ? "notOverYet"
            : undefined;
    if (code !== undefined) {
      return yield* new InvalidInput({ problems: [{ path: "source.range.end", code }] });
    }
  });

const toState = (row: typeof playbackStates.$inferSelect): PlaybackState => ({
  userId: UserId.make(row.userId),
  target:
    row.targetKind === "Recording"
      ? { _tag: "Recording", recordingId: RecordingId.make(row.targetId) }
      : { _tag: "Programme", programmeId: ProgrammeId.make(row.targetId) },
  positionMillis: row.positionMillis,
  watched: row.watched,
  updatedAt: toInstant(row.updatedAt),
});

const targetKey = (target: PlaybackTarget) =>
  target._tag === "Recording"
    ? { targetKind: "Recording" as const, targetId: target.recordingId as string }
    : { targetKind: "Programme" as const, targetId: target.programmeId as string };

const makePlayback = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const auth = yield* Auth;
  const signing = yield* Signing;
  const recorder = yield* Recorder;
  const hardware = yield* Hardware;
  const settings = yield* Settings;
  const config = yield* ServerConfig;
  const transcoder = yield* Transcoder;
  const bus = yield* EventBus;
  const sessions = yield* Ref.make(new Map<string, OpenSession>());

  /** Absolute when a public URL is configured; otherwise a path the client resolves. */
  const link = (path: string) => `${config.publicUrl ?? ""}${path}`;

  const exists = (table: typeof channels | typeof recordings | typeof programmes, id: string) =>
    read
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .pipe(
        Effect.map((rows) => rows.length > 0),
        Effect.orDie,
      );

  const liveExists = (channelId: string) =>
    read
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, channelId), liveChannel))
      .pipe(
        Effect.map((rows) => rows.length > 0),
        Effect.orDie,
      );

  const recordingRow = (recordingId: string) =>
    read
      .select({
        channelId: recordings.channelId,
        startMs: retainedStartSql,
        endMs: retainedEndSql,
      })
      .from(recordings)
      .where(eq(recordings.id, recordingId))
      .pipe(
        Effect.map((rows) => rows[0]),
        Effect.orDie,
      );

  /** The newest segment of a channel inside `[fromMs, toMs)`, with its capture. */
  const sampleSegment = (channelId: string, fromMs: number, toMs: number) =>
    read
      .select({
        captureId: captures.id,
        directory: captures.directory,
        streamInfo: captures.streamInfo,
        path: segments.path,
      })
      .from(segments)
      .innerJoin(captures, eq(captures.id, segments.captureId))
      .where(overlapping(channelId, fromMs, toMs))
      .orderBy(desc(segments.startMs))
      .limit(1)
      .pipe(
        Effect.map((rows) => rows[0]),
        Effect.orDie,
      );

  /**
   * What the newest capture of a channel that knows it says its stream carries: the recorder
   * stores what ffmpeg reports about its input as a capture starts, before the first segment.
   */
  const latestCaptureInfo = (channelId: string) =>
    read
      .select({ streamInfo: captures.streamInfo })
      .from(captures)
      .where(and(eq(captures.channelId, channelId), sql`${captures.streamInfo} IS NOT NULL`))
      .orderBy(desc(captures.startedAt))
      .limit(1)
      .pipe(
        Effect.map(([row]) =>
          row?.streamInfo === null || row === undefined
            ? undefined
            : readStreamInfo(row.streamInfo),
        ),
        Effect.orDie,
      );

  /**
   * What the stream carries, from the capture's stored probe or by probing one of its segments
   * (stored for next time); for live without a segment yet, what its starting capture reported.
   * `undefined` before anything was captured.
   */
  const streamInfoFor = (source: PlaybackSessionRequest["source"]) =>
    Effect.gen(function* () {
      let sample: Effect.Success<ReturnType<typeof sampleSegment>>;
      switch (source._tag) {
        case "Live":
          sample = yield* sampleSegment(source.channelId, 0, Number.MAX_SAFE_INTEGER);
          if (sample === undefined) return yield* latestCaptureInfo(source.channelId);
          break;
        case "Recording": {
          const row = yield* recordingRow(source.recordingId);
          sample =
            row === undefined
              ? undefined
              : yield* sampleSegment(row.channelId, row.startMs, row.endMs);
          break;
        }
        case "Range":
          sample = yield* sampleSegment(
            source.channelId,
            DateTime.toEpochMillis(source.range.start),
            DateTime.toEpochMillis(source.range.end),
          );
          break;
      }
      if (sample === undefined) return undefined;
      const stored = sample.streamInfo === null ? undefined : readStreamInfo(sample.streamInfo);
      if (stored !== undefined) return stored;
      const probed = yield* probe({ url: `${sample.directory}/${sample.path}` }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not probe a segment", cause).pipe(Effect.as(undefined)),
        ),
      );
      if (probed !== undefined) {
        yield* write
          .update(captures)
          .set({ streamInfo: storeStreamInfo(probed) })
          .where(eq(captures.id, sample.captureId))
          .pipe(Effect.orDie);
      }
      return probed;
    });

  /**
   * The quality a session aims for and the network it is judged by: the device's own choice, or
   * for its "Household default" (`Auto`) the household's default where it plays from
   * (`sessionQuality`). Away from home counts as remote, so a household "Automatic" starts lower.
   */
  const qualityFor = (request: PlaybackSessionRequest, origin: RequestOrigin) =>
    Effect.gen(function* () {
      const situation = qualitySituation({ network: request.network, away: origin === "away" });
      const network = situation === "away" ? "remote" : request.network;
      if (request.quality._tag !== "Auto") return { quality: request.quality, network };
      const household = yield* settings.playback;
      const quality = qualityRequest(sessionQuality("auto", household.quality, situation));
      return { quality, network };
    });

  /**
   * What the stream of a new session carries. A live channel never captured before has nothing
   * to tell yet: its capture was just started (`capturing`), so this waits until the capture
   * reports its input or writes its first segment (announced, or found in the index, whichever
   * comes first). Without a capture there is nothing to wait for.
   */
  const firstStreamInfo = (source: PlaybackSessionRequest["source"], capturing: boolean) =>
    source._tag !== "Live" || !capturing
      ? streamInfoFor(source)
      : Effect.scoped(
          Effect.gen(function* () {
            const next = yield* bus.nextSegment(source.channelId);
            const known = yield* streamInfoFor(source);
            if (known !== undefined) return known;
            const indexed = streamInfoFor(source).pipe(
              Effect.repeat({
                until: (info) => info !== undefined,
                schedule: Schedule.spaced(FIRST_SEGMENT_POLL),
              }),
            );
            const found = yield* Effect.timeoutOption(
              Effect.raceFirst(Effect.andThen(next, streamInfoFor(source)), indexed),
              FIRST_SEGMENT_WAIT,
            );
            return Option.getOrUndefined(found);
          }),
        );

  /**
   * How a session on `channelId` is delivered: the plan (absent while nothing is known about
   * the stream), and the variant that converts it, if anything converts.
   */
  const decide = (
    channelId: string | undefined,
    sessionId: string,
    request: PlaybackSessionRequest,
    origin: RequestOrigin,
    stream: Effect.Success<ReturnType<typeof streamInfoFor>>,
  ) =>
    Effect.gen(function* () {
      if (stream === undefined) return {} satisfies Decision;
      const planned: TranscodePlan = decideTranscode({
        stream,
        capabilities: request.capabilities,
        ...(yield* qualityFor(request, origin)),
        measuredKbps: request.measuredKbps,
        playbackRate: request.playbackRate,
        audioLanguage: request.audioLanguage,
        hardware: (yield* hardware.caps) ?? softwareOnly,
      });
      let plan = planned;
      // A live picture conversion is shared by everyone converting the channel the same way.
      const key = conversionKey(
        conversionStream(request.source, sessionId),
        variantName(planned) ?? "",
      );
      if (planned.video._tag === "Encode") {
        const onHardware = planned.video.encoder !== "software";
        if (yield* transcoder.videoBusy(key, onHardware)) {
          const original = withOriginalVideo(planned);
          yield* Effect.logWarning(
            original === undefined
              ? "Every picture conversion is in use; this one waits its turn"
              : "Every picture conversion is in use; serving the original picture",
          ).pipe(Effect.annotateLogs({ reasons: planned.reasons.join(",") }));
          plan = original ?? planned;
        }
      }
      const variant = variantName(plan);
      if (variant === undefined && plan.decision !== "direct") {
        // Only repackaging: the stored segments are MPEG-TS already.
        yield* Effect.logInfo("Serving the original segments").pipe(
          Effect.annotateLogs({ wanted: plan.decision, reasons: plan.reasons.join(",") }),
        );
        return {} satisfies Decision;
      }
      if (plan.video._tag === "Encode") yield* transcoder.touchVideo(key);
      if (variant !== undefined) {
        yield* Effect.logInfo("Converting playback").pipe(
          Effect.annotateLogs({ channelId, variant, reasons: plan.reasons.join(",") }),
        );
      }
      return (variant === undefined ? { plan } : { plan, variant }) satisfies Decision;
    });

  const respond = (id: string, session: OpenSession): PlaybackSession => ({
    id: PlaybackSessionId.make(id),
    playlistUrl: session.playlistUrl,
    ...(session.decision.plan === undefined ? {} : { plan: session.decision.plan }),
    ...(session.startAt === undefined ? {} : { startAt: session.startAt }),
    expiresAt: session.expiresAt,
  });

  /**
   * Joins or starts the channel's capture for a live session: whether it holds one now. A
   * refusal only gets logged (the next playlist request tries again).
   */
  const holdLive = (channelId: string, sessionId: string) =>
    recorder.acquireLive(ChannelId.make(channelId), sessionId).pipe(
      Effect.as(true),
      Effect.catchTag("RecorderFailed", (error) =>
        Effect.logWarning("No capture for live playback yet").pipe(
          Effect.annotateLogs({ channelId, reason: error.reason }),
          Effect.as(false),
        ),
      ),
    );

  /** The enabled sources a channel's streams come from, in fallback order. */
  const sourcesOf = (channelId: string) =>
    read
      .select({
        id: sources.id,
        maxStreams: sources.maxStreams,
        keptForRecordings: sources.keptForRecordings,
      })
      .from(channelStreams)
      .innerJoin(sourceStreams, eq(sourceStreams.id, channelStreams.sourceStreamId))
      .innerJoin(sources, eq(sources.id, sourceStreams.sourceId))
      .where(and(eq(channelStreams.channelId, channelId), eq(sources.enabled, true)))
      .orderBy(asc(channelStreams.priority))
      .pipe(
        Effect.map((rows) => [...new Map(rows.map((row) => [row.id, row])).values()]),
        Effect.orDie,
      );

  /** Refuses a live session that no stream is left for (SPEC 7.9). */
  const checkStreams = (viewer: Viewer, channelId: string) =>
    Effect.gen(function* () {
      const streams = yield* recorder.streams;
      const held = new Set(
        streams.flatMap((stream) => stream.consumers.map((consumer) => consumer.id)),
      );
      const mine = [...(yield* Ref.get(sessions))].filter(
        ([id, open]) =>
          open.userId === viewer.user.id && open.request.source._tag === "Live" && held.has(id),
      ).length;
      const verdict = liveVerdict({
        channelId,
        sources: yield* sourcesOf(channelId),
        streams,
        profileLimit: viewer.access.maxStreams,
        profileWatching: mine,
      });
      switch (verdict._tag) {
        case "ok":
          return;
        case "profileLimit":
          return yield* new StreamLimitReached({ reason: "profileLimit" });
        case "sourceFull":
          return yield* new StreamLimitReached({
            reason: "sourceFull",
            ...(verdict.sourceId === undefined
              ? {}
              : { sourceId: SourceId.make(verdict.sourceId) }),
          });
      }
    });

  /**
   * The recording if the viewer may see it. An anchor was deleted by a person (its row only
   * holds its chain's search, §3.7), so it is gone for everyone unless `anchors` asks for it.
   */
  const visibleRecording = (
    viewer: Viewer,
    recordingId: string,
    options: { readonly anchors?: boolean } = {},
  ) =>
    Effect.gen(function* () {
      const stored = yield* loadRecording(read, recordingId);
      if (stored === undefined) return undefined;
      if (isAnchor(stored.recording) && options.anchors !== true) return undefined;
      return (yield* seesRecording(read, viewer, stored, config.timeZone)) ? stored : undefined;
    });

  /** The recording; `NotFound` unless the viewer may see it. */
  const requireRecording = (viewer: Viewer, recordingId: string) =>
    Effect.flatMap(visibleRecording(viewer, recordingId), (stored) =>
      stored === undefined
        ? Effect.fail(new NotFound({ entity: "recording", id: recordingId }))
        : Effect.succeed(stored),
    );

  /** Checks the viewer may play `source` now; a recording comes back with its stored row. */
  const requireSource = (viewer: Viewer, source: PlaybackSessionRequest["source"]) =>
    Effect.gen(function* () {
      switch (source._tag) {
        case "Live":
        case "Range":
          if (source._tag === "Range") yield* checkRange(source.range);
          yield* requireChannel(viewer, source.channelId);
          // A removed channel's timeshift still plays; it has nothing live left to watch.
          if (
            !(yield* source._tag === "Live"
              ? liveExists(source.channelId)
              : exists(channels, source.channelId))
          ) {
            return yield* new NotFound({ entity: "channel", id: source.channelId });
          }
          return undefined;
        case "Recording":
          return yield* requireRecording(viewer, source.recordingId);
      }
    });

  /**
   * Refuses a range the timeshift buffer does not hold (`RangeNotCaptured`): it starts before the
   * channel's oldest captured segment (the buffer moved on, or capturing started later), or
   * nothing inside it was captured at all. An empty stream would only play as an endless spinner.
   */
  const requireCaptured = (channelId: string, range: TimeRange) =>
    Effect.gen(function* () {
      const start = DateTime.toEpochMillis(range.start);
      const end = DateTime.toEpochMillis(range.end);
      const [oldest] = yield* read
        .select({ startMs: sql<number | null>`min(${segments.startMs})` })
        .from(segments)
        .innerJoin(captures, eq(captures.id, segments.captureId))
        .where(eq(captures.channelId, channelId))
        .pipe(Effect.orDie);
      const captured =
        oldest?.startMs !== null &&
        oldest?.startMs !== undefined &&
        start >= oldest.startMs &&
        (yield* sampleSegment(channelId, start, end)) !== undefined;
      if (!captured) {
        return yield* new RangeNotCaptured({ channelId: ChannelId.make(channelId), range });
      }
    });

  /**
   * The earliest moment a viewer may play of a channel outside recordings: a collection-limited
   * profile only within the live DVR window (older stretches belong to recordings, which it may
   * only see in its collections); everyone else has no floor.
   */
  const rangeFloor = (viewer: Viewer) =>
    Effect.gen(function* () {
      if (viewer.access.collectionIds === undefined) return undefined;
      const now = yield* Clock.currentTimeMillis;
      return now - (yield* recorder.dvrWindowMs);
    });

  /** The channel a source plays: its own, or the recording's. */
  const channelOf = (
    source: PlaybackSessionRequest["source"],
    stored: Effect.Success<ReturnType<typeof requireSource>>,
  ): string | undefined =>
    source._tag === "Recording" ? stored?.recording.channelId : source.channelId;

  /**
   * A signed playlist path for `source`: a live window, a recording's retained range, or the
   * requested range from no earlier than `floor` (see `rangeFloor`). `sessionId` is the
   * playback session (live hold), `client` the sign-in the token dies with. A converting
   * session's playlist is named by its `variant`, which its tokens carry.
   */
  const playlistPath = (
    actor: User,
    source: PlaybackSessionRequest["source"],
    stored: Effect.Success<ReturnType<typeof requireSource>>,
    sessionId: string,
    client: PlaybackClient,
    floor: number | undefined,
    variant: string | undefined,
  ) =>
    Effect.gen(function* () {
      const channelId = channelOf(source, stored);
      const base = {
        u: actor.id,
        sid: client.sessionId,
        ...(variant === undefined ? {} : { x: variant }),
        ...(variant === undefined || channelId === undefined ? {} : { c: channelId }),
        ...(variant === undefined ? {} : { k: sessionStream(sessionId) }),
      };
      const file = (id: string) =>
        `${encodeURIComponent(id)}${variant === undefined ? "" : `/${variant}`}.m3u8`;
      switch (source._tag) {
        case "Live": {
          const { token, exp } = yield* signing.signHls(
            { ...base, s: scopes.live(source.channelId) },
            HLS_TOKEN_MILLIS,
          );
          // The session id lets the HLS routes tell the recorder this viewer is still watching.
          const path = `/hls/live/${file(source.channelId)}?session=${sessionId}&token=${token}`;
          return { path, exp };
        }
        case "Recording": {
          const range = stored === undefined ? undefined : retainedRange(stored);
          const { token, exp } = yield* signing.signHls(
            {
              ...base,
              s: scopes.recording(source.recordingId),
              ...(range === undefined ? {} : { from: range.startMs, to: range.endMs }),
            },
            HLS_TOKEN_MILLIS,
          );
          const path = `/hls/recordings/${file(source.recordingId)}?token=${token}`;
          return { path, exp };
        }
        case "Range": {
          const from = DateTime.toEpochMillis(source.range.start);
          const to = DateTime.toEpochMillis(source.range.end);
          // The scope names the range asked for; the window it opens starts no earlier than
          // the floor, which moves on while a long session renews its token.
          const opens = Math.min(to, Math.max(from, floor ?? from));
          const { token, exp } = yield* signing.signHls(
            { ...base, s: scopes.range(source.channelId, from, to), from: opens, to },
            HLS_TOKEN_MILLIS,
          );
          const path = `/hls/range/${file(source.channelId)}?from=${from}&to=${to}&token=${token}`;
          return { path, exp };
        }
      }
    });

  const createSession = Effect.fn("Playback.createSession")(function* (
    actor: User,
    request: PlaybackSessionRequest,
    client: PlaybackClient,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const viewer = yield* loadViewer(read, actor);
    const { source } = request;
    const stored = yield* requireSource(viewer, source);
    // A collection-limited profile may start over only within the live DVR window; older
    // stretches of a channel belong to recordings, which it may only see in its collections.
    const floor = yield* rangeFloor(viewer);
    if (
      source._tag === "Range" &&
      floor !== undefined &&
      DateTime.toEpochMillis(source.range.start) < floor
    ) {
      return yield* new Forbidden();
    }
    if (source._tag === "Range") yield* requireCaptured(source.channelId, source.range);
    // Sessions nobody ended outlive their tokens only until the next one is created.
    yield* Ref.update(
      sessions,
      (map) => new Map([...map].filter(([, open]) => DateTime.toEpochMillis(open.expiresAt) > now)),
    );
    const id = newId();
    let startAt: number | undefined;
    let holding = false;
    switch (source._tag) {
      case "Live":
        yield* checkStreams(viewer, source.channelId);
        holding = yield* holdLive(source.channelId, id);
        break;
      case "Recording": {
        const [resume] = yield* read
          .select()
          .from(playbackStates)
          .where(
            and(
              eq(playbackStates.userId, actor.id),
              eq(playbackStates.targetKind, "Recording"),
              eq(playbackStates.targetId, source.recordingId),
            ),
          )
          .pipe(Effect.orDie);
        const playlistStart = stored === undefined ? undefined : retainedRange(stored).startMs;
        startAt =
          resume !== undefined && !resume.watched && playlistStart !== undefined
            ? playlistStart + resume.positionMillis
            : undefined;
        break;
      }
      case "Range":
        startAt = DateTime.toEpochMillis(source.range.start);
        break;
    }
    const decision = yield* decide(
      channelOf(source, stored),
      id,
      request,
      client.origin,
      yield* firstStreamInfo(source, holding),
    );
    const { path, exp } = yield* playlistPath(
      actor,
      source,
      stored,
      id,
      client,
      floor,
      decision.variant,
    );
    const session: OpenSession = {
      userId: actor.id,
      request,
      playlistUrl: link(path),
      startAt: startAt === undefined ? undefined : toInstant(startAt),
      expiresAt: toInstant(exp),
      createdAt: now,
      deviceName: client.deviceName,
      origin: client.origin,
      decision,
    };
    yield* Ref.update(sessions, (map) => new Map(map).set(id, session));
    return respond(id, session);
  });

  const ownSession = (actor: User, sessionId: string) =>
    Effect.gen(function* () {
      const session = (yield* Ref.get(sessions)).get(sessionId);
      if (session === undefined || session.userId !== actor.id) {
        return yield* new NotFound({ entity: "playbackSession", id: sessionId });
      }
      return session;
    });

  /**
   * A player fetched something for a session (`userId` is whom its HLS token was signed for).
   * A live session keeps its capture; one the recorder let go while nobody fetched (app in the
   * background, laptop asleep) holds it again, since the viewer is back. Unknown sessions,
   * other users' sessions and non-live sessions are ignored.
   */
  const touch = (sessionId: string, userId: string) =>
    Effect.gen(function* () {
      const session = (yield* Ref.get(sessions)).get(sessionId);
      if (session === undefined || session.userId !== userId) return;
      const source = session.request.source;
      if (source._tag !== "Live") return;
      if (yield* recorder.touchLive(sessionId)) return;
      yield* holdLive(source.channelId, sessionId);
    });

  /**
   * Applies an update and renews the session: access is checked again and the answer carries a
   * new playlist URL with a fresh token (an empty update only renews).
   */
  const updateSession = (
    actor: User,
    sessionId: string,
    update: PlaybackSessionUpdate,
    client: PlaybackClient,
  ) =>
    Effect.gen(function* () {
      const session = yield* ownSession(actor, sessionId);
      const viewer = yield* loadViewer(read, actor);
      const { source } = session.request;
      const stored = yield* requireSource(viewer, source);
      const floor = yield* rangeFloor(viewer);
      const request = { ...session.request, ...update };
      const decision = yield* decide(
        channelOf(source, stored),
        sessionId,
        request,
        client.origin,
        yield* streamInfoFor(source),
      );
      const { path, exp } = yield* playlistPath(
        actor,
        source,
        stored,
        sessionId,
        client,
        floor,
        decision.variant,
      );
      const next: OpenSession = {
        ...session,
        request,
        origin: client.origin,
        playlistUrl: link(path),
        expiresAt: toInstant(exp),
        decision,
      };
      yield* Ref.update(sessions, (map) => new Map(map).set(sessionId, next));
      yield* touch(sessionId, actor.id);
      return respond(sessionId, next);
    });

  /** Forgets a session and lets go of its capture (a conversion stops when nobody fetches). */
  const close = (sessionId: string, session: OpenSession) =>
    Effect.gen(function* () {
      yield* Ref.update(sessions, (map) => {
        const next = new Map(map);
        next.delete(sessionId);
        return next;
      });
      if (session.request.source._tag === "Live") yield* recorder.releaseLive(sessionId);
    });

  const endSession = (actor: User, sessionId: string) =>
    Effect.flatMap(ownSession(actor, sessionId), (session) => close(sessionId, session));

  /** Live sessions that have not expired, for the streams overview. */
  const liveSessions = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return [...(yield* Ref.get(sessions))].flatMap(([id, open]): Array<LiveSession> =>
      open.request.source._tag === "Live" && DateTime.toEpochMillis(open.expiresAt) > now
        ? [
            {
              id,
              userId: open.userId,
              channelId: open.request.source.channelId,
              createdAt: open.createdAt,
              deviceName: open.deviceName,
            },
          ]
        : [],
    );
  });

  /**
   * Ends someone's live session ("Stop arte on Kitchen Shield"); the caller checked who may.
   * Returns `false` for a session that is not live or does not exist.
   */
  const stopLive = (sessionId: string) =>
    Effect.gen(function* () {
      const session = (yield* Ref.get(sessions)).get(sessionId);
      if (session === undefined || session.request.source._tag !== "Live") return false;
      yield* close(sessionId, session);
      return true;
    });

  /**
   * Checks the viewer may keep a position on `target`: a recording it sees, or a programme on
   * a channel it sees. Anything else is `NotFound`, like it does not exist.
   */
  const requireTarget = (viewer: Viewer, target: PlaybackTarget) =>
    Effect.gen(function* () {
      if (target._tag === "Recording") {
        yield* requireRecording(viewer, target.recordingId);
        return;
      }
      // A guide entry airs on every channel that carries its guide channel.
      const rows = yield* read
        .select({ channelId: channels.id })
        .from(programmes)
        .innerJoin(channels, onLiveChannel(programmes.guideChannelId))
        .where(eq(programmes.id, target.programmeId))
        .pipe(Effect.orDie);
      if (!rows.some((row) => seesChannel(viewer, row.channelId))) {
        return yield* new NotFound({ entity: "programme", id: target.programmeId });
      }
    });

  const state = (actor: User, recordingId: string) =>
    Effect.gen(function* () {
      const viewer = yield* loadViewer(read, actor);
      yield* requireRecording(viewer, recordingId);
      const [row] = yield* read
        .select()
        .from(playbackStates)
        .where(
          and(
            eq(playbackStates.userId, actor.id),
            eq(playbackStates.targetKind, "Recording"),
            eq(playbackStates.targetId, recordingId),
          ),
        )
        .pipe(Effect.orDie);
      if (row !== undefined) return toState(row);
      return {
        userId: actor.id,
        target: { _tag: "Recording", recordingId: RecordingId.make(recordingId) },
        positionMillis: 0,
        watched: false,
        updatedAt: toInstant(yield* Clock.currentTimeMillis),
      } satisfies PlaybackState;
    });

  const saveState = (actor: User, progress: PlaybackProgress) =>
    Effect.gen(function* () {
      yield* requireTarget(yield* loadViewer(read, actor), progress.target);
      const key = targetKey(progress.target);
      const row = {
        userId: actor.id,
        ...key,
        positionMillis: progress.positionMillis,
        watched: progress.watched,
        updatedAt: yield* Clock.currentTimeMillis,
      };
      yield* write
        .insert(playbackStates)
        .values(row)
        .onConflictDoUpdate({
          target: [playbackStates.userId, playbackStates.targetKind, playbackStates.targetId],
          set: {
            positionMillis: row.positionMillis,
            watched: row.watched,
            updatedAt: row.updatedAt,
          },
        })
        .pipe(Effect.orDie);
      return toState(row);
    });

  const continueWatching = (actor: User) =>
    read
      .select()
      .from(playbackStates)
      .where(
        and(
          eq(playbackStates.userId, actor.id),
          eq(playbackStates.watched, false),
          gt(playbackStates.positionMillis, 0),
        ),
      )
      .orderBy(desc(playbackStates.updatedAt))
      .limit(CONTINUE_LIMIT)
      .pipe(
        Effect.map((rows) => rows.map(toState)),
        Effect.orDie,
      );

  /**
   * Whether an HLS grant still holds for a playlist request: the sign-in it was issued under is
   * still there (not signed out, expired or a revoked device), its user still exists, and still
   * sees the channel or recording.
   */
  const admits = (grant: HlsGrant, target: HlsTarget) =>
    Effect.gen(function* () {
      const user = yield* signedInAs(grant);
      if (user === undefined) return false;
      const viewer = yield* loadViewer(read, user);
      switch (target._tag) {
        case "Channel":
          return seesChannel(viewer, target.channelId);
        // The grant of a recording deleted since still holds: its playlist answers NotFound.
        case "Recording":
          return (
            (yield* visibleRecording(viewer, target.recordingId, { anchors: true })) !== undefined
          );
      }
    });

  /** The user a grant's sign-in still signs in, if it is the grant's user. */
  const signedInAs = (grant: HlsGrant) =>
    Effect.gen(function* () {
      if (grant.sid === undefined) return undefined;
      const user = yield* auth.sessionUser(grant.sid);
      return user !== undefined && user.id === grant.u ? user : undefined;
    });

  return {
    createSession,
    updateSession,
    admits,
    /** Whether a grant's sign-in still holds (checked for every segment). */
    signedIn: (grant: HlsGrant) => Effect.map(signedInAs(grant), (user) => user !== undefined),
    endSession,
    touch,
    state,
    saveState,
    continueWatching,
    liveSessions,
    stopLive,
  };
});

/** Playback sessions and positions. */
export class Playback extends Context.Service<Playback, Effect.Success<typeof makePlayback>>()(
  "@slipstream/server/Playback",
) {
  static readonly layer = Layer.effect(Playback, makePlayback);
}
