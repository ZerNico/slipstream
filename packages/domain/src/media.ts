import { Schema } from "effect";
import { Instant } from "./time.ts";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** The probed video track of a stream. */
export const VideoTrack = Schema.Struct({
  codec: Schema.String,
  profile: Schema.optionalKey(Schema.String),
  level: Schema.optionalKey(Schema.String),
  width: PositiveInt,
  height: PositiveInt,
  fps: Schema.Finite,
  interlaced: Schema.Boolean,
}).annotate({ identifier: "VideoTrack" });
export type VideoTrack = typeof VideoTrack.Type;

/** One probed audio track. */
export const AudioTrack = Schema.Struct({
  codec: Schema.String,
  channels: Schema.optionalKey(PositiveInt),
  language: Schema.optionalKey(Schema.String),
  bitrateKbps: Schema.optionalKey(NonNegativeInt),
}).annotate({ identifier: "AudioTrack" });
export type AudioTrack = typeof AudioTrack.Type;

/** What ffprobe saw on a source stream or capture. */
export const StreamInfo = Schema.Struct({
  container: Schema.String,
  video: Schema.optionalKey(VideoTrack),
  audio: Schema.Array(AudioTrack),
  bitrateKbps: Schema.optionalKey(NonNegativeInt),
  probedAt: Instant,
}).annotate({ identifier: "StreamInfo" });
export type StreamInfo = typeof StreamInfo.Type;

/** A video codec a device can decode, with the limits it reported. */
export const VideoDecoder = Schema.Struct({
  codec: Schema.String,
  profiles: Schema.Array(Schema.String),
  maxWidth: PositiveInt,
  maxHeight: PositiveInt,
}).annotate({ identifier: "VideoDecoder" });
export type VideoDecoder = typeof VideoDecoder.Type;

/** What a client reported it can play when it started a playback session. */
export const MediaCapabilities = Schema.Struct({
  video: Schema.Array(VideoDecoder),
  audio: Schema.Array(Schema.String),
  /** Audio codecs the device passes through to a receiver (AC3, EAC3). */
  audioPassthrough: Schema.Array(Schema.String),
  hdr: Schema.Boolean,
  canDeinterlace: Schema.Boolean,
  maxBitrateKbps: Schema.optionalKey(PositiveInt),
}).annotate({ identifier: "MediaCapabilities" });
export type MediaCapabilities = typeof MediaCapabilities.Type;

/** Cheapest option that works, in increasing cost (PLAN 6.11). */
export const TranscodeDecision = Schema.Literals(["direct", "remux", "audio", "video"]);
export type TranscodeDecision = typeof TranscodeDecision.Type;

/**
 * Why a session is not played directly. `catchUpPassthrough`: surround sound passed through to a
 * receiver cannot be sped up, so catch-up converts it to stereo. `mobileData`: the automatic
 * quality for a phone on cellular capped the bitrate.
 */
export const TranscodeReason = Schema.Literals([
  "containerUnsupported",
  "audioCodecUnsupported",
  "videoCodecUnsupported",
  "resolutionTooHigh",
  "interlaced",
  "bandwidth",
  "requestedQuality",
  "catchUpPassthrough",
  "mobileData",
]);
export type TranscodeReason = typeof TranscodeReason.Type;

/** Which encoder a video transcode runs on. */
export const Encoder = Schema.Literals(["software", "qsv", "vaapi", "nvenc"]);
export type Encoder = typeof Encoder.Type;

/**
 * The quality a client asked for: the household default (`Auto`), the original, or a bitrate
 * cap. The server turns `Auto` into the household's default for the situation first.
 */
export const QualityRequest = Schema.TaggedUnion({
  Auto: {},
  Original: {},
  Bitrate: { kbps: PositiveInt },
}).annotate({ identifier: "QualityRequest" });
export type QualityRequest = typeof QualityRequest.Type;
