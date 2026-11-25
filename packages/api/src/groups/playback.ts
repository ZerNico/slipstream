import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import {
  Instant,
  MediaCapabilities,
  NetworkKind,
  PlaybackSessionId,
  PlaybackSource,
  PlaybackState,
  PlaybackTarget,
  QualityRequest,
  RecordingId,
  TranscodePlan,
} from "@slipstream/domain";
import {
  Forbidden,
  InvalidInput,
  NotFound,
  RangeNotCaptured,
  StreamLimitReached,
} from "../errors.ts";
import { Authentication } from "../security.ts";

/** What to play: live, a recording or a captured range. Defined in the domain. */
export { PlaybackSource } from "@slipstream/domain";

const PlaybackRate = Schema.Finite.check(Schema.isBetween({ minimum: 0.25, maximum: 4 }));
const MeasuredKbps = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** A client asks to play something and says what it can decode. */
export const PlaybackSessionRequest = Schema.Struct({
  source: PlaybackSource,
  capabilities: MediaCapabilities,
  /**
   * The device's quality. `Auto` is its "Household default": the server takes the household's
   * default for home, away (judged from the client's address) or mobile data (`sessionQuality`).
   */
  quality: QualityRequest,
  network: Schema.optionalKey(NetworkKind),
  /** Throughput the client measured, in kbit/s; lets "Auto" step down. */
  measuredKbps: Schema.optionalKey(MeasuredKbps),
  /** Playback speed; above 1 while catching up (surround passthrough then turns stereo). */
  playbackRate: Schema.optionalKey(PlaybackRate),
  /** Preferred audio language as the guide reports it, e.g. "deu". */
  audioLanguage: Schema.optionalKey(Schema.String),
  /**
   * A live session the player starts behind the live edge (from the start of the rewind buffer,
   * a resume position): its picture conversion is its own rather than shared with the channel's
   * live viewers, and counts so against the server's limit.
   */
  startsBehindLive: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "PlaybackSessionRequest" });
export type PlaybackSessionRequest = typeof PlaybackSessionRequest.Type;

/**
 * Changes during a session: catch-up speed, a picked quality, a new throughput measurement.
 * Every update also renews the session's playlist token.
 */
export const PlaybackSessionUpdate = Schema.Struct({
  quality: Schema.optionalKey(QualityRequest),
  network: Schema.optionalKey(NetworkKind),
  measuredKbps: Schema.optionalKey(MeasuredKbps),
  playbackRate: Schema.optionalKey(PlaybackRate),
  audioLanguage: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "PlaybackSessionUpdate" });
export type PlaybackSessionUpdate = typeof PlaybackSessionUpdate.Type;

/** The server's answer: the playlist to load and how it will be delivered. */
export const PlaybackSession = Schema.Struct({
  id: PlaybackSessionId,
  /**
   * HLS playlist URL carrying a short-lived signed token (players do not send auth headers). The
   * token opens only what the session plays (a range exactly its range, a recording its retained
   * range, live the DVR window) and ends with the sign-in that asked for it.
   */
  playlistUrl: Schema.String,
  /**
   * How the stream is converted on its way, for the player overlay ("720p · 4 Mbit/s · converted
   * because: mobile data"); absent when it plays as it is. `deliveryOf` in the domain reads it.
   */
  plan: Schema.optionalKey(TranscodePlan),
  /** Where playback should start: the resume position, or the programme start for start over. */
  startAt: Schema.optionalKey(Instant),
  /**
   * When the playlist token expires. To keep playing longer, update the session before then
   * (an empty update will do): the answer carries a new `playlistUrl` and `expiresAt`.
   */
  expiresAt: Instant,
}).annotate({ identifier: "PlaybackSession" });
export type PlaybackSession = typeof PlaybackSession.Type;

/** A client reports its position. */
export const PlaybackProgress = Schema.Struct({
  target: PlaybackTarget,
  positionMillis: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  watched: Schema.Boolean,
}).annotate({ identifier: "PlaybackProgress" });
export type PlaybackProgress = typeof PlaybackProgress.Type;

/**
 * Playback: sessions with the transcoding decision (`decideTranscode` in the domain), updated
 * when the speed or quality changes, plus resume positions and continue watching. A live or
 * range session that needs a stream no source can give answers `StreamLimitReached`; a range the
 * timeshift buffer no longer holds answers `RangeNotCaptured`. A collection-limited profile may
 * start a range only within the live DVR window (`Forbidden`).
 */
export class PlaybackGroup extends HttpApiGroup.make("playback")
  .add(
    HttpApiEndpoint.post("createSession", "/sessions", {
      payload: PlaybackSessionRequest,
      success: PlaybackSession,
      error: [NotFound, InvalidInput, StreamLimitReached, Forbidden, RangeNotCaptured],
    }),
    HttpApiEndpoint.patch("updateSession", "/sessions/:playbackSessionId", {
      params: { playbackSessionId: PlaybackSessionId },
      payload: PlaybackSessionUpdate,
      success: PlaybackSession,
      error: [NotFound, InvalidInput],
    }),
    HttpApiEndpoint.delete("endSession", "/sessions/:playbackSessionId", {
      params: { playbackSessionId: PlaybackSessionId },
      error: NotFound,
    }),
    HttpApiEndpoint.get("state", "/state/recordings/:recordingId", {
      params: { recordingId: RecordingId },
      success: PlaybackState,
      error: NotFound,
    }),
    HttpApiEndpoint.put("saveState", "/state", {
      payload: PlaybackProgress,
      success: PlaybackState,
      error: [NotFound, InvalidInput],
    }),
    HttpApiEndpoint.get("continueWatching", "/continue", {
      success: Schema.Array(PlaybackState),
    }),
  )
  .middleware(Authentication)
  .prefix("/playback")
  .annotateMerge(OpenApi.annotations({ title: "Playback" })) {}
