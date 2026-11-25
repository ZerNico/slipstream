import { Schema } from "effect";
import { CaptureId, ChannelId, SourceStreamId } from "./ids.ts";
import { StreamInfo } from "./media.ts";
import { Instant } from "./time.ts";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Lifecycle of one ffmpeg capture run. */
export const CaptureState = Schema.Literals([
  "starting",
  "running",
  "reconnecting",
  "stopped",
  "failed",
]);
export type CaptureState = typeof CaptureState.Type;

/** Why a capture failed or had to reconnect, in terms a person can act on. */
export const CaptureError = Schema.TaggedUnion({
  SourceUnreachable: { message: Schema.String },
  SourceLimitReached: { httpStatus: Schema.optionalKey(Schema.Int) },
  NoData: {},
  FfmpegExited: { exitCode: Schema.Int, message: Schema.String },
}).annotate({ identifier: "CaptureError" });
export type CaptureError = typeof CaptureError.Type;

/**
 * Why the recorder could not capture, lost a stream, or ended a recording: the recorder's typed
 * vocabulary, carried end to end in its events. Clients render the words.
 */
export const CaptureReason = Schema.Literals([
  /** Every stream the source allows was busy, or the provider refused one. */
  "sourceLimit",
  /** The source could not be reached. */
  "sourceUnreachable",
  /** The stream dropped while capturing; the capture reconnected. */
  "streamDropped",
  /** The channel has no stream to open. */
  "noStream",
  /** Nothing was captured. */
  "noData",
  /** The slot was over before it could be recorded (the server was down). */
  "missed",
  /** Someone stopped it. */
  "stopped",
  /** A recording needed the stream, so a live viewer or buffer lost it. */
  "preempted",
  /** The disk is almost full. */
  "diskLow",
]);
export type CaptureReason = typeof CaptureReason.Type;

/** Running counters of a capture. */
export const CaptureStats = Schema.Struct({
  bytes: NonNegativeInt,
  segments: NonNegativeInt,
  reconnects: NonNegativeInt,
  bitrateKbps: Schema.optionalKey(NonNegativeInt),
}).annotate({ identifier: "CaptureStats" });
export type CaptureStats = typeof CaptureStats.Type;

/** One upstream connection for a channel, shared by every consumer (viewers, recordings). */
export const Capture = Schema.Struct({
  id: CaptureId,
  channelId: ChannelId,
  sourceStreamId: SourceStreamId,
  startedAt: Instant,
  endedAt: Schema.optionalKey(Instant),
  state: CaptureState,
  error: Schema.optionalKey(CaptureError),
  stats: CaptureStats,
  streamInfo: Schema.optionalKey(StreamInfo),
}).annotate({ identifier: "Capture" });
export type Capture = typeof Capture.Type;
