/** ffprobe a stream or file into the domain's {@link StreamInfo}. */
import type { StreamInfo } from "@slipstream/domain";
import { Clock, DateTime, Duration, Effect, Schema } from "effect";
import { ProbeFailed, type BinaryNotFound } from "./errors.ts";
import { FfmpegConfig, inputArgs, type InputOptions } from "./ffmpeg.ts";
import { toStreamInfo, type ProbedAudio, type ProbedStream, type ProbedVideo } from "./model.ts";
import { runToCompletion } from "./process.ts";

const optionalString = Schema.optionalKey(Schema.String);
const optionalNumber = Schema.optionalKey(Schema.Number);

/** The part of `ffprobe -print_format json -show_streams -show_format` we read. */
const ProbeOutput = Schema.Struct({
  streams: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        index: Schema.Number,
        codec_type: optionalString,
        codec_name: optionalString,
        profile: optionalString,
        level: optionalNumber,
        width: optionalNumber,
        height: optionalNumber,
        avg_frame_rate: optionalString,
        r_frame_rate: optionalString,
        field_order: optionalString,
        pix_fmt: optionalString,
        channels: optionalNumber,
        channel_layout: optionalString,
        sample_rate: optionalString,
        bit_rate: optionalString,
        tags: Schema.optionalKey(Schema.Struct({ language: optionalString })),
      }),
    ),
  ),
  format: Schema.optionalKey(
    Schema.Struct({ format_name: optionalString, bit_rate: optionalString }),
  ),
});
type ProbeOutput = typeof ProbeOutput.Type;

const decodeProbeOutput = Schema.decodeUnknownEffect(Schema.fromJsonString(ProbeOutput));

const intOrNull = (value: string | number | undefined): number | null => {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};

/** `25/1` or `30000/1001` to frames per second, rounded to 3 decimals. */
const frameRate = (ratio: string | undefined): number | null => {
  const [num, den] = (ratio ?? "").split("/").map(Number);
  if (!num || !den || !Number.isFinite(num) || !Number.isFinite(den)) return null;
  return Math.round((num / den) * 1000) / 1000;
};

/** ffprobe field order: `progressive`, or `tt`/`bb`/`tb`/`bt` for interlaced content. */
const interlacedFrom = (fieldOrder: string | undefined): boolean | null => {
  if (fieldOrder === undefined || fieldOrder === "unknown") return null;
  return fieldOrder !== "progressive";
};

/** Maps parsed ffprobe JSON onto {@link ProbedStream}. Pure, exported for tests. */
export const streamInfoFromProbe = (output: ProbeOutput): ProbedStream => {
  const streams = output.streams ?? [];
  const video: Array<ProbedVideo> = streams
    .filter((stream) => stream.codec_type === "video")
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name ?? "unknown",
      profile: stream.profile ?? null,
      level: stream.level !== undefined && stream.level >= 0 ? stream.level : null,
      width: intOrNull(stream.width),
      height: intOrNull(stream.height),
      fps: frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate),
      interlaced: interlacedFrom(stream.field_order),
      pixelFormat: stream.pix_fmt ?? null,
    }));
  const audio: Array<ProbedAudio> = streams
    .filter((stream) => stream.codec_type === "audio")
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name ?? "unknown",
      profile: stream.profile ?? null,
      channels: intOrNull(stream.channels),
      channelLayout: stream.channel_layout ?? null,
      sampleRate: intOrNull(stream.sample_rate),
      language:
        stream.tags?.language && stream.tags.language !== "und" ? stream.tags.language : null,
      bitrate: intOrNull(stream.bit_rate),
    }));
  return {
    container: output.format?.format_name ?? null,
    bitrate: intOrNull(output.format?.bit_rate),
    video,
    audio,
  };
};

/** Options for {@link probe}. */
export interface ProbeOptions extends InputOptions {
  /** Give up after this long. Default 20 seconds. */
  readonly timeout?: Duration.Input;
}

/**
 * Probes a URL or file with ffprobe: container, video codec/profile/level, resolution, frame
 * rate, interlacing and audio tracks.
 */
export const probe = (
  options: ProbeOptions,
): Effect.Effect<StreamInfo, ProbeFailed | BinaryNotFound> =>
  Effect.gen(function* () {
    const { ffprobe } = yield* FfmpegConfig;
    const fail = (message: string) => new ProbeFailed({ url: options.url, message });
    const result = yield* runToCompletion(ffprobe, [
      "-hide_banner",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      ...inputArgs(options),
    ]).pipe(
      Effect.timeoutOrElse({
        duration: options.timeout ?? Duration.seconds(20),
        orElse: () => Effect.fail(fail("ffprobe timed out")),
      }),
      Effect.catchTag("ProcessFailed", (error) =>
        Effect.fail(fail(error.stderr.trim() || `ffprobe exited with ${error.exitCode}`)),
      ),
    );
    const output = yield* decodeProbeOutput(result.stdout).pipe(
      Effect.mapError((error) => fail(`unreadable ffprobe output: ${error.message}`)),
    );
    const info = streamInfoFromProbe(output);
    if (info.video.length === 0 && info.audio.length === 0) {
      return yield* fail("no audio or video tracks found");
    }
    return toStreamInfo(info, DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
  });
