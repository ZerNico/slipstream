/**
 * The ffmpeg command that converts one stored segment for a variant (pure; `service.ts` runs
 * it). Every segment is converted on its own, so seeking, timeshift, recordings and many
 * viewers all work on the segment store as they do for the original, and a converted segment
 * can be cached and shared by everyone watching the same variant.
 *
 * Timestamps are kept (`-copyts`), so a converted segment lines up with its neighbours and with
 * the playlist's times exactly like the original.
 *
 * **Audio without clicks.** An AAC encoder started cold on every segment would put a priming frame
 * (and a few milliseconds of overlap) at every boundary, which plays as a click every six
 * seconds. Instead, all encodes share one frame grid: AAC frames of 1024 samples on multiples
 * of 1024 at 48 kHz in the stream's own timeline. A segment owns the grid frames from
 * `ceil(start) - lag` to `ceil(end) - lag` (start and end of its audio packets), encodes from a
 * little before that with the previous segment of the same run as warm-up input (`lookback`),
 * and drops every frame outside its share (`noise` bitstream filter). Neighbouring segments
 * therefore hand over on the same frame, each frame is encoded from a warm encoder, and the
 * audio PTS run on without a gap or an overlap. The lag keeps a segment's last frames clear of
 * the end of its input, where the encoder would pad with silence; the next segment encodes
 * them from real samples. (A run's first segment has nothing to warm up with and starts on its
 * first whole frame.) At the 33-bit timestamp wrap, every 26.5 hours, one boundary may click.
 *
 * **Video.** A converted picture is decoded from the segment alone, unless the segment opens
 * with frames that show before its first keyframe (an open GOP, as MPEG-2 broadcasts send): then
 * the previous segment is decoded too, so those frames have their reference, and dropped again
 * before the encoder. The encoder is the hardware one the decision picked, else libx264.
 */
import type { AudioPlan, Encoder, RateControl, VideoPlan } from "@slipstream/domain";
import type { Variant } from "./variant.ts";

/** Samples in one AAC-LC frame. */
export const AAC_FRAME_SAMPLES = 1024;
/** How far before the grid point after its end a segment hands over to the next one. */
export const HANDOVER_LAG_SAMPLES = 2 * AAC_FRAME_SAMPLES;
/** How much audio before its share a segment feeds the encoder to warm it up. */
export const WARMUP_SAMPLES = 4 * AAC_FRAME_SAMPLES;
/** The sample rate of converted audio. */
export const AAC_SAMPLE_RATE = 48_000;
/** MPEG-TS timestamps tick at 90 kHz. */
const TS_CLOCK = 90_000;

/** What a segment's packets say, as `probeArgs` reads it (`parseSegmentProbe`). */
export interface SegmentProbe {
  /** The converted audio track's packets: first PTS and the end of the last, 90 kHz ticks. */
  readonly audio?: { readonly startPts: number; readonly endPts: number } | undefined;
  /**
   * The video: its earliest PTS, and whether frames show before the first keyframe (open GOP),
   * so decoding needs the previous segment.
   */
  readonly video?: { readonly startPts: number; readonly openGop: boolean } | undefined;
}

/** One segment to convert. */
export interface SegmentJob {
  readonly segment: string;
  /** The previous segment of the same capture run, when it is still stored. */
  readonly lookback?: string | undefined;
  readonly variant: Variant;
  readonly probe: SegmentProbe;
  readonly output: string;
}

/** The share of the AAC frame grid a segment encodes, in 48 kHz samples of its timeline. */
export interface AudioWindow {
  /** Where the encoder starts (warm-up included). */
  readonly encodeFrom: number;
  /** The first frame the segment keeps. */
  readonly keepFrom: number;
  /** The first frame it leaves to the next segment. */
  readonly keepUntil: number;
}

const toSamples = (pts: number): number => Math.round((pts * AAC_SAMPLE_RATE) / TS_CLOCK);
const gridUp = (samples: number): number =>
  Math.ceil(samples / AAC_FRAME_SAMPLES) * AAC_FRAME_SAMPLES;

/** The frames a segment keeps; with no `lookback` it starts cold on its first whole frame. */
export const audioWindow = (
  audio: NonNullable<SegmentProbe["audio"]>,
  lookback: boolean,
): AudioWindow => {
  const first = gridUp(toSamples(audio.startPts));
  const keepFrom = lookback ? first - HANDOVER_LAG_SAMPLES : first;
  return {
    encodeFrom: lookback ? keepFrom - WARMUP_SAMPLES : keepFrom,
    keepFrom,
    keepUntil: gridUp(toSamples(audio.endPts)) - HANDOVER_LAG_SAMPLES,
  };
};

/** The VA-API render node. */
export const VAAPI_DEVICE = "/dev/dri/renderD128";

/** Hardware device set-up an encoder needs before its inputs. */
export const hardwareDeviceArgs = (encoder: Encoder): Array<string> =>
  encoder === "vaapi"
    ? ["-vaapi_device", VAAPI_DEVICE]
    : encoder === "qsv"
      ? ["-init_hw_device", "qsv=hw", "-filter_hw_device", "hw"]
      : [];

/** The filter that hands a software frame to the encoder. */
export const uploadFilter = (encoder: Encoder): string =>
  encoder === "vaapi"
    ? "format=nv12,hwupload"
    : encoder === "qsv"
      ? "format=nv12,hwupload=extra_hw_frames=16"
      : // NVENC takes frames from system memory; x264 wants 8-bit 4:2:0 like every H.264 decoder.
        encoder === "nvenc"
        ? "format=nv12"
        : "format=yuv420p";

/** Rate control for an encoder at `kbps` (ignored in constant-quality mode). */
export const rateControlArgs = (
  encoder: Encoder,
  mode: RateControl,
  kbps: number,
): Array<string> => {
  const bitrate = `${kbps}k`;
  const peak = `${mode === "cbr" ? kbps : Math.round(kbps * 1.5)}k`;
  const buffer = `${kbps * 2}k`;
  switch (encoder) {
    case "software":
      return ["-b:v", bitrate, "-maxrate", peak, "-bufsize", buffer];
    case "nvenc":
      return mode === "cqp"
        ? ["-rc", "constqp", "-qp", "23"]
        : ["-rc", mode, "-b:v", bitrate, "-maxrate", peak];
    case "vaapi":
      return mode === "cqp"
        ? ["-rc_mode", "CQP", "-qp", "23"]
        : ["-rc_mode", mode.toUpperCase(), "-b:v", bitrate, "-maxrate", peak];
    case "qsv":
      return mode === "cqp"
        ? ["-q:v", "23"]
        : ["-b:v", bitrate, "-maxrate", peak, "-bufsize", buffer];
  }
};

/** The ffmpeg encoder for H.264 on `encoder`. */
export const h264Encoder = (encoder: Encoder): string =>
  encoder === "software" ? "libx264" : `h264_${encoder}`;

type EncodeVideo = Extract<VideoPlan, { readonly _tag: "Encode" }>;
type EncodeAudio = Extract<AudioPlan, { readonly _tag: "Encode" }>;

const videoFilter = (video: EncodeVideo, trimFrom: number | undefined): string =>
  [
    ...(trimFrom === undefined ? [] : [`trim=start_pts=${trimFrom}`]),
    ...(video.deinterlace === undefined
      ? []
      : [`bwdif=mode=${video.deinterlace === "field" ? "send_field" : "send_frame"}:deint=all`]),
    `scale=${video.width}:${video.height}`,
    uploadFilter(video.encoder),
  ].join(",");

const videoEncoderArgs = (video: EncodeVideo): Array<string> => [
  "-c:v",
  h264Encoder(video.encoder),
  ...(video.encoder === "software" ? ["-preset", "veryfast", "-profile:v", "high"] : []),
  ...rateControlArgs(video.encoder, video.rateControl, video.bitrateKbps),
  "-g",
  String(Math.max(1, Math.round(video.fps * 2))),
  // Keep every frame's timestamp, so the segment lines up with the original's.
  "-fps_mode",
  "passthrough",
];

const audioEncoderArgs = (audio: EncodeAudio, window: AudioWindow | undefined): Array<string> => [
  "-c:a",
  "aac",
  "-b:a",
  `${audio.bitrateKbps}k`,
  "-ac",
  String(audio.channels),
  "-ar",
  String(AAC_SAMPLE_RATE),
  // The encoder's packets carry timestamps in 1/48000 here, before the muxer's 90 kHz.
  ...(window === undefined
    ? []
    : ["-bsf:a", `noise=drop='lt(pts\\,${window.keepFrom})+gte(pts\\,${window.keepUntil})'`]),
];

/** The ffmpeg arguments that convert one segment into `job.output` (MPEG-TS). */
export const segmentArgs = (job: SegmentJob): Array<string> => {
  const { video, audio } = job.variant;
  const audioFromLookback =
    audio._tag === "Encode" && job.lookback !== undefined && job.probe.audio !== undefined;
  const videoFromLookback =
    video._tag === "Encode" && job.lookback !== undefined && job.probe.video?.openGop === true;
  const lookbackInput = audioFromLookback || videoFromLookback;
  // Input 0 is the segment; input 1, when needed, the previous segment and this one in a row.
  const inputs = [
    "-i",
    job.segment,
    ...(lookbackInput ? ["-i", `concat:${job.lookback}|${job.segment}`] : []),
  ];
  const filters: Array<string> = [];
  const maps: Array<string> = [];
  const codecs: Array<string> = [];

  switch (video._tag) {
    case "None":
      break;
    case "Copy":
      maps.push("-map", "0:v:0?");
      codecs.push("-c:v", "copy");
      break;
    case "Encode":
      filters.push(
        `[${videoFromLookback ? 1 : 0}:v:0]${videoFilter(video, videoFromLookback ? job.probe.video?.startPts : undefined)}[v]`,
      );
      maps.push("-map", "[v]");
      codecs.push(...videoEncoderArgs(video));
      break;
  }

  switch (audio._tag) {
    case "None":
      break;
    case "Copy":
      maps.push("-map", "0:a?");
      codecs.push("-c:a", "copy");
      break;
    case "Encode": {
      const window =
        job.probe.audio === undefined ? undefined : audioWindow(job.probe.audio, audioFromLookback);
      const trim = window === undefined ? "" : `,atrim=start_pts=${window.encodeFrom}`;
      filters.push(
        `[${audioFromLookback ? 1 : 0}:a:${audio.trackIndex}]aresample=${AAC_SAMPLE_RATE}${trim}[a]`,
      );
      maps.push("-map", "[a]");
      codecs.push(...audioEncoderArgs(audio, window));
      break;
    }
  }

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    ...(video._tag === "Encode" ? hardwareDeviceArgs(video.encoder) : []),
    "-copyts",
    ...inputs,
    ...(filters.length === 0 ? [] : ["-filter_complex", filters.join(";")]),
    ...maps,
    ...codecs,
    "-f",
    "mpegts",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-y",
    job.output,
  ];
};

/** ffprobe arguments that list a segment's streams and packets (`parseSegmentProbe` reads it). */
export const probeArgs = (segment: string): Array<string> => [
  "-v",
  "error",
  "-show_entries",
  "stream=index,codec_type:packet=stream_index,pts,duration,flags",
  "-of",
  "json",
  segment,
];

interface ProbeJson {
  readonly streams?: ReadonlyArray<{ readonly index?: number; readonly codec_type?: string }>;
  readonly packets?: ReadonlyArray<{
    readonly stream_index?: number;
    readonly pts?: number;
    readonly duration?: number;
    readonly flags?: string;
  }>;
}

/** Reads `probeArgs` output for the audio track `audioTrack` (counted among audio streams). */
export const parseSegmentProbe = (json: string, audioTrack: number): SegmentProbe => {
  let parsed: ProbeJson;
  try {
    parsed = JSON.parse(json) as ProbeJson;
  } catch {
    return {};
  }
  const streams = parsed.streams ?? [];
  const packets = parsed.packets ?? [];
  const audioIndex = streams.filter((stream) => stream.codec_type === "audio")[audioTrack]?.index;
  const videoIndex = streams.find((stream) => stream.codec_type === "video")?.index;

  const audioPackets = packets.filter(
    (packet) => packet.stream_index === audioIndex && packet.pts !== undefined,
  );
  const firstAudio = audioPackets[0];
  const lastAudio = audioPackets.at(-1);
  const audio =
    firstAudio?.pts === undefined || lastAudio?.pts === undefined
      ? undefined
      : { startPts: firstAudio.pts, endPts: lastAudio.pts + (lastAudio.duration ?? 0) };

  const videoPts = packets
    .filter((packet) => packet.stream_index === videoIndex && packet.pts !== undefined)
    .map((packet) => ({ pts: packet.pts ?? 0, key: packet.flags?.startsWith("K") === true }));
  const firstKey = videoPts.find((packet) => packet.key);
  const video =
    videoPts.length === 0
      ? undefined
      : {
          startPts: Math.min(...videoPts.map((packet) => packet.pts)),
          openGop: firstKey !== undefined && videoPts.some((packet) => packet.pts < firstKey.pts),
        };
  return { audio, video };
};
