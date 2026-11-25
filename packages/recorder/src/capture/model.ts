/**
 * Capture shapes at the level ffmpeg works on: segments with their run, tracks and run
 * statistics; the capture's lifecycle uses the domain's `CaptureState`. Times are epoch
 * milliseconds; durations are milliseconds.
 */
import type { Instant, StreamInfo } from "@slipstream/domain";
import { Schema } from "effect";

const Millis = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One MPEG-TS file in the segment store. */
export const Segment = Schema.Struct({
  captureId: Schema.String,
  /** The ffmpeg run that wrote it; a new run starts after every reconnect. */
  runId: Schema.String,
  /** Monotonic across all runs of one capture, so it doubles as the HLS media sequence. */
  sequence: Count,
  /** Wall-clock start (epoch ms). */
  startMs: Millis,
  durationMs: Millis,
  bytes: Count,
  /** Relative to the capture directory. */
  path: Schema.String,
});
export type Segment = typeof Segment.Type;

/** A video track as reported by ffprobe or ffmpeg's input summary. */
export const ProbedVideo = Schema.Struct({
  index: Count,
  codec: Schema.String,
  profile: Schema.NullOr(Schema.String),
  level: Schema.NullOr(Schema.Number),
  width: Schema.NullOr(Count),
  height: Schema.NullOr(Count),
  fps: Schema.NullOr(Schema.Number),
  interlaced: Schema.NullOr(Schema.Boolean),
  pixelFormat: Schema.NullOr(Schema.String),
});
export type ProbedVideo = typeof ProbedVideo.Type;

/** An audio track as reported by ffprobe or ffmpeg's input summary. */
export const ProbedAudio = Schema.Struct({
  index: Count,
  codec: Schema.String,
  profile: Schema.NullOr(Schema.String),
  channels: Schema.NullOr(Count),
  channelLayout: Schema.NullOr(Schema.String),
  sampleRate: Schema.NullOr(Count),
  language: Schema.NullOr(Schema.String),
  bitrate: Schema.NullOr(Count),
});
export type ProbedAudio = typeof ProbedAudio.Type;

/** What a stream carries: container, codecs, resolution, frame rate and audio tracks. */
export const ProbedStream = Schema.Struct({
  container: Schema.NullOr(Schema.String),
  /** Overall bitrate in bits per second, when known. */
  bitrate: Schema.NullOr(Count),
  video: Schema.Array(ProbedVideo),
  audio: Schema.Array(ProbedAudio),
});
export type ProbedStream = typeof ProbedStream.Type;

const kbps = (bits: number | null) => (bits === null ? undefined : Math.round(bits / 1000));

/**
 * What ffprobe or ffmpeg saw, in the domain's terms: the first video track, every audio track,
 * bitrates in kbit/s. Everything outside the recorder sees only this.
 */
export const toStreamInfo = (probed: ProbedStream, probedAt: Instant): StreamInfo => {
  const video = probed.video[0];
  const overall = kbps(probed.bitrate);
  return {
    container: probed.container ?? "mpegts",
    ...(video === undefined || video.width === null || video.height === null
      ? {}
      : {
          video: {
            codec: video.codec,
            ...(video.profile === null ? {} : { profile: video.profile }),
            ...(video.level === null ? {} : { level: String(video.level) }),
            width: Math.max(1, video.width),
            height: Math.max(1, video.height),
            fps: video.fps ?? 25,
            interlaced: video.interlaced ?? false,
          },
        }),
    audio: probed.audio.map((track) => {
      const bitrateKbps = kbps(track.bitrate);
      return {
        codec: track.codec,
        ...(track.channels === null || track.channels < 1 ? {} : { channels: track.channels }),
        ...(track.language === null ? {} : { language: track.language }),
        ...(bitrateKbps === undefined ? {} : { bitrateKbps }),
      };
    }),
    ...(overall === undefined ? {} : { bitrateKbps: overall }),
    probedAt,
  };
};

/** Running numbers for one capture run. */
export const RunCounters = Schema.Struct({
  runId: Schema.String,
  /** Bits per second over the segments written so far in this run. */
  bitrate: Schema.NullOr(Count),
  totalBytes: Count,
  segments: Count,
  /** Media time written, in milliseconds. */
  mediaMs: Millis,
  /** ffmpeg's processing speed relative to real time (1 means live). */
  speed: Schema.NullOr(Schema.Number),
});
export type RunCounters = typeof RunCounters.Type;

/** Why an ffmpeg run stopped. */
export const RunEndReason = Schema.Literals(["exited", "stalled", "spawn-failed"]);
export type RunEndReason = typeof RunEndReason.Type;

/** One ffmpeg process lifetime inside a capture. */
export const CaptureRun = Schema.Struct({
  captureId: Schema.String,
  runId: Schema.String,
  /** 1-based count of runs in this capture. */
  runIndex: Count,
  startedAtMs: Millis,
  endedAtMs: Schema.NullOr(Millis),
  endReason: Schema.NullOr(RunEndReason),
  exitCode: Schema.NullOr(Schema.Int),
  /** The last error line ffmpeg printed, in its own words. */
  lastError: Schema.NullOr(Schema.String),
  segments: Count,
});
export type CaptureRun = typeof CaptureRun.Type;

/** Severity of an ffmpeg log line we pass on. */
export const LogLevel = Schema.Literals(["warning", "error", "fatal"]);
export type LogLevel = typeof LogLevel.Type;

/** Everything a capture reports while it runs, suitable for SSE. */
export const CaptureEvent = Schema.Union([
  Schema.TaggedStruct("RunStarted", { run: CaptureRun }),
  Schema.TaggedStruct("StreamDetected", { runId: Schema.String, info: ProbedStream }),
  Schema.TaggedStruct("SegmentAdded", { segment: Segment }),
  Schema.TaggedStruct("Stats", { stats: RunCounters }),
  Schema.TaggedStruct("Log", { runId: Schema.String, level: LogLevel, message: Schema.String }),
  Schema.TaggedStruct("RunEnded", { run: CaptureRun }),
  /**
   * `attempt` counts consecutive failed runs (no segment, or shorter than the capture's
   * `minHealthyRunMs`); 0 after a healthy run.
   */
  Schema.TaggedStruct("Reconnecting", {
    afterRunId: Schema.String,
    attempt: Count,
    delayMs: Millis,
  }),
]);
export type CaptureEvent = typeof CaptureEvent.Type;
