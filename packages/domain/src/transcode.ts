import { Schema } from "effect";
import {
  type AudioTrack,
  Encoder,
  type MediaCapabilities,
  type QualityRequest,
  type StreamInfo,
  TranscodeDecision,
  TranscodeReason,
  type VideoDecoder,
  type VideoTrack,
} from "./media.ts";

/*
 * The per-session transcoding decision (PLAN 6.11): the cheapest delivery that works on the
 * device, the network and the quality someone picked. Pure; the server runs ffmpeg from the plan.
 */

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** How the client reaches the server. Feeds the "Auto" quality. */
export const NetworkKind = Schema.Literals(["lan", "wifi", "mobile", "remote"]);
export type NetworkKind = typeof NetworkKind.Type;

/** Named rungs of the quality ladder, best first. */
export const QualityLevel = Schema.Literals(["original", "high", "medium", "dataSaver"]);
export type QualityLevel = typeof QualityLevel.Type;

/** One rung: a total bitrate and the tallest picture it carries. `original` has neither. */
export interface QualityRung {
  readonly level: QualityLevel;
  readonly bitrateKbps?: number | undefined;
  readonly maxHeight?: number | undefined;
}

/** Original, High 8 Mbit/s, Medium 4 Mbit/s, Data saver 2 Mbit/s. */
export const qualityLadder = [
  { level: "original" },
  { level: "high", bitrateKbps: 8000, maxHeight: 1080 },
  { level: "medium", bitrateKbps: 4000, maxHeight: 720 },
  { level: "dataSaver", bitrateKbps: 2000, maxHeight: 540 },
] as const satisfies ReadonlyArray<QualityRung>;

/** A rung with a bitrate cap: every one but the original. */
type CappedRung = Extract<(typeof qualityLadder)[number], { readonly bitrateKbps: number }>;

/** The capped rungs, best first. */
const cappedRungs: readonly CappedRung[] = qualityLadder.filter(
  (candidate): candidate is CappedRung => "bitrateKbps" in candidate,
);

/** A cap as players and settings name it: its bitrate in kbit/s, "8000". */
const capChoice = (candidate: CappedRung): `${CappedRung["bitrateKbps"]}` =>
  `${candidate.bitrateKbps}`;

/**
 * The qualities a player's menu and the server-wide defaults offer: the server's automatic
 * choice, the original, or one of the ladder's caps by its bitrate in kbit/s. The caps come
 * from `qualityLadder`, so a new rung shows up in every menu at once.
 */
export const QualityChoice = Schema.Literals(["auto", "original", ...cappedRungs.map(capChoice)]);
export type QualityChoice = typeof QualityChoice.Type;

/** Every quality a player offers, best first after Auto. */
export const qualityChoices: readonly QualityChoice[] = QualityChoice.literals;

/** What a quality choice asks the server for. */
export const qualityRequest = (choice: QualityChoice): QualityRequest =>
  choice === "auto"
    ? { _tag: "Auto" }
    : choice === "original"
      ? { _tag: "Original" }
      : { _tag: "Bitrate", kbps: Number(choice) };

/** Roughly the picture height a cap gives ("up to 720p"); none for Auto or the original. */
export const qualityCapHeight = (choice: QualityChoice): number | undefined =>
  cappedRungs.find((candidate) => capChoice(candidate) === choice)?.maxHeight;

/** The situations the household's default quality tells apart (Settings › Default quality). */
export const QualitySituation = Schema.Literals(["home", "away", "mobile"]);
export type QualitySituation = typeof QualitySituation.Type;

/** The household's default quality in each situation; "auto" there is the automatic choice. */
export type QualityDefaults = Readonly<Record<QualitySituation, QualityChoice>>;

/**
 * Where a session plays from: on mobile data when the device says so; away when it says it is
 * remote or the server sees it come from outside the home network; else at home.
 */
export const qualitySituation = (input: {
  readonly network?: NetworkKind | undefined;
  /** The server saw the request come from outside the home network. */
  readonly away?: boolean | undefined;
}): QualitySituation =>
  input.network === "mobile"
    ? "mobile"
    : input.network === "remote" || input.away === true
      ? "away"
      : "home";

/**
 * What wins: a device's own quality, unless it is "auto" (the device's "Household default");
 * then the household's default for the situation. That default may be "auto" too, which
 * `resolveQuality` reads as automatic by network and measured throughput. The server asks the
 * transcode decision for this; clients only send the device's choice.
 */
export const sessionQuality = (
  device: QualityChoice,
  defaults: QualityDefaults,
  situation: QualitySituation,
): QualityChoice => (device === "auto" ? defaults[situation] : device);

/**
 * What the device's "Household default" stands for, for its hint. A device knows when it is on
 * mobile data, but not whether it is at home or away (only the server sees that), so off mobile
 * data it is the home and away defaults, or one quality when they agree.
 */
export type HouseholdDefaultHint =
  | { readonly _tag: "One"; readonly quality: QualityChoice }
  | { readonly _tag: "HomeOrAway"; readonly home: QualityChoice; readonly away: QualityChoice };

/** The hint for a device whose quality is the household default, connected over `network`. */
export const householdDefaultHint = (
  defaults: QualityDefaults,
  network: NetworkKind | undefined,
): HouseholdDefaultHint => {
  if (network === "mobile") return { _tag: "One", quality: defaults.mobile };
  if (network === "remote") return { _tag: "One", quality: defaults.away };
  return defaults.home === defaults.away
    ? { _tag: "One", quality: defaults.home }
    : { _tag: "HomeOrAway", home: defaults.home, away: defaults.away };
};

const rung = (level: QualityLevel): QualityRung =>
  qualityLadder.find((candidate: QualityRung) => candidate.level === level) ?? {
    level: "original",
  };

/** What "Auto" picks per network before throughput is known (design: quality by situation). */
export const autoQualityByNetwork: Readonly<Record<NetworkKind, QualityLevel>> = {
  lan: "original",
  wifi: "original",
  remote: "high",
  mobile: "medium",
};

/** Share of the measured throughput a stream may use, leaving room for spikes. */
export const throughputHeadroom = 0.75;

/** A stream up to this factor above a cap still counts as fitting, so 8.3 Mbit/s is not converted for 8. */
export const bitrateTolerance = 1.1;

/** The quality a session aims for, and why it is capped when it is. */
export interface QualityTarget {
  readonly level: QualityLevel;
  /** Total bitrate cap; absent for the original. */
  readonly bitrateKbps?: number | undefined;
  readonly maxHeight?: number | undefined;
  /** Why there is a cap: `requestedQuality`, `mobileData` or `bandwidth`. */
  readonly reason?: "requestedQuality" | "mobileData" | "bandwidth" | undefined;
}

/** What the quality decision reads besides the request. */
export interface QualityConditions {
  readonly network?: NetworkKind | undefined;
  /** Throughput the client measured, in kbit/s. */
  readonly measuredKbps?: number | undefined;
  /** Bitrate of the original, so "Auto" keeps it when the throughput carries it. */
  readonly sourceKbps?: number | undefined;
}

const fromRung = (level: QualityLevel, reason: QualityTarget["reason"]): QualityTarget => {
  const { bitrateKbps, maxHeight } = rung(level);
  return bitrateKbps === undefined ? { level } : { level, bitrateKbps, maxHeight, reason };
};

/** The best rung whose bitrate fits `kbps`; the lowest rung when none does. */
const rungFitting = (kbps: number): QualityLevel =>
  cappedRungs.find((candidate) => candidate.bitrateKbps <= kbps)?.level ?? "dataSaver";

/**
 * Turns a quality request into a target. "Original" is never capped. An explicit bitrate is
 * taken as asked. "Auto" starts from the network default (at home the original, away High,
 * on mobile data Medium) and steps down when the measured throughput is lower.
 */
export const resolveQuality = (
  request: QualityRequest,
  conditions: QualityConditions,
): QualityTarget => {
  switch (request._tag) {
    case "Original":
      return { level: "original" };
    case "Bitrate": {
      const level = rungFitting(request.kbps);
      return {
        level,
        bitrateKbps: request.kbps,
        maxHeight: rung(level).maxHeight,
        reason: "requestedQuality",
      };
    }
    case "Auto": {
      const network = conditions.network;
      const level = network === undefined ? "original" : autoQualityByNetwork[network];
      const preferred = fromRung(level, network === "mobile" ? "mobileData" : "bandwidth");
      if (conditions.measuredKbps === undefined) return preferred;
      const usable = conditions.measuredKbps * throughputHeadroom;
      const preferredKbps = preferred.bitrateKbps ?? conditions.sourceKbps;
      if (preferredKbps === undefined || preferredKbps <= usable * bitrateTolerance) {
        return preferred;
      }
      return fromRung(rungFitting(usable), "bandwidth");
    }
  }
};

/** A rate-control mode an encoder accepts. Some drivers only allow constant quality (CQP). */
export const RateControl = Schema.Literals(["vbr", "cbr", "cqp"]);
export type RateControl = typeof RateControl.Type;

/** A hardware encoder that passed the startup test encode. */
export const HardwareEncoder = Schema.Struct({
  encoder: Encoder,
  /** Codecs it encoded in the test, e.g. `["h264", "hevc"]`. */
  codecs: Schema.Array(Schema.String),
  rateControl: Schema.Array(RateControl),
}).annotate({ identifier: "HardwareEncoder" });
export type HardwareEncoder = typeof HardwareEncoder.Type;

/** What hardware acceleration detection found, in preference order. Software is always there. */
export const HardwareCaps = Schema.Struct({
  encoders: Schema.Array(HardwareEncoder),
}).annotate({ identifier: "HardwareCaps" });
export type HardwareCaps = typeof HardwareCaps.Type;

/** No hardware acceleration: everything runs on the CPU. */
export const softwareOnly: HardwareCaps = { encoders: [] };

/** How interlaced video is turned progressive: one frame per field (50p) or per frame (25p). */
export const DeinterlaceMode = Schema.Literals(["field", "frame"]);
export type DeinterlaceMode = typeof DeinterlaceMode.Type;

/** What happens to the video track. */
export const VideoPlan = Schema.TaggedUnion({
  /** The stream has no video (radio). */
  None: {},
  Copy: {},
  Encode: {
    codec: Schema.Literal("h264"),
    encoder: Encoder,
    rateControl: RateControl,
    bitrateKbps: PositiveInt,
    width: PositiveInt,
    height: PositiveInt,
    fps: Schema.Finite,
    deinterlace: Schema.optionalKey(DeinterlaceMode),
  },
}).annotate({ identifier: "VideoPlan" });
export type VideoPlan = typeof VideoPlan.Type;

/** What happens to the chosen audio track. */
export const AudioPlan = Schema.TaggedUnion({
  None: {},
  Copy: { trackIndex: Schema.Int },
  Encode: {
    trackIndex: Schema.Int,
    codec: Schema.Literal("aac"),
    channels: PositiveInt,
    bitrateKbps: PositiveInt,
  },
}).annotate({ identifier: "AudioPlan" });
export type AudioPlan = typeof AudioPlan.Type;

/**
 * The decision for one session: the level, every reason (the first is the main one, shown in the
 * player overlay), the quality aimed for, and what ffmpeg does to each track.
 */
export const TranscodePlan = Schema.Struct({
  decision: TranscodeDecision,
  reasons: Schema.Array(TranscodeReason),
  quality: QualityLevel,
  video: VideoPlan,
  audio: AudioPlan,
}).annotate({ identifier: "TranscodePlan" });
export type TranscodePlan = typeof TranscodePlan.Type;

/** How a stream reaches the player, as the overlay names it. */
export interface Delivery {
  readonly decision: TranscodeDecision;
  readonly reasons: ReadonlyArray<TranscodeReason>;
  /** The encoder when the video is converted. */
  readonly encoder?: Encoder | undefined;
}

/** The delivery a session's plan says; without a plan the stream plays as it is. */
export const deliveryOf = (plan: TranscodePlan | undefined): Delivery =>
  plan === undefined
    ? { decision: "direct", reasons: [] }
    : {
        decision: plan.decision,
        reasons: plan.reasons,
        ...(plan.video._tag === "Encode" ? { encoder: plan.video.encoder } : {}),
      };

const codecAliases: Readonly<Record<string, string>> = {
  avc: "h264",
  avc1: "h264",
  avc3: "h264",
  "h.264": "h264",
  h265: "hevc",
  "h.265": "hevc",
  hvc1: "hevc",
  hev1: "hevc",
  mpeg2: "mpeg2video",
  av01: "av1",
  vp09: "vp9",
  "ac-3": "ac3",
  "ec-3": "eac3",
  mp4a: "aac",
  mp2a: "mp2",
  ".mp3": "mp3",
};

/**
 * Maps the codec names ffprobe and clients use to one spelling: "avc1.640028" and "H.264" are
 * "h264", "hvc1" is "hevc", "ac-3" is "ac3". Unknown names are lower-cased and kept.
 */
export const normaliseCodec = (codec: string): string => {
  const lower = codec.trim().toLowerCase();
  const exact = codecAliases[lower];
  if (exact !== undefined) return exact;
  const family = lower.split(".")[0] ?? lower;
  return codecAliases[family] ?? family;
};

const sameText = (a: string, b: string): boolean =>
  a.replace(/[\s_-]/gu, "").toLowerCase() === b.replace(/[\s_-]/gu, "").toLowerCase();

/** Containers HLS delivery carries without repackaging (MPEG-TS segments). */
export const hlsContainers: ReadonlyArray<string> = ["mpegts"];

/** True when the probed container (ffprobe lists aliases like "matroska,webm") fits HLS as is. */
export const isHlsContainer = (container: string): boolean =>
  container
    .toLowerCase()
    .split(",")
    .some((name) => hlsContainers.includes(name.trim()));

const decodersFor = (video: VideoTrack, capabilities: MediaCapabilities): Array<VideoDecoder> =>
  capabilities.video.filter(
    (decoder) =>
      normaliseCodec(decoder.codec) === normaliseCodec(video.codec) &&
      (decoder.profiles.length === 0 ||
        video.profile === undefined ||
        decoder.profiles.some((profile) => sameText(profile, video.profile ?? ""))),
  );

const fits = (video: VideoTrack, decoder: VideoDecoder): boolean =>
  video.width <= decoder.maxWidth && video.height <= decoder.maxHeight;

/** A typical H.264 bitrate for a picture height, used when ffprobe reported none. */
export const typicalBitrateKbps = (height: number): number =>
  height > 1080 ? 20_000 : height > 720 ? 8000 : height > 576 ? 5000 : 3000;

const hasCodec = (list: ReadonlyArray<string>, codec: string): boolean =>
  list.some((candidate) => normaliseCodec(candidate) === normaliseCodec(codec));

/** Picks the audio track in the wanted language, otherwise the first one. */
const chooseAudio = (
  tracks: ReadonlyArray<AudioTrack>,
  language: string | undefined,
): { readonly track: AudioTrack; readonly index: number } | undefined => {
  const wanted =
    language === undefined
      ? -1
      : tracks.findIndex((track) => track.language?.toLowerCase() === language.toLowerCase());
  const index = wanted >= 0 ? wanted : 0;
  const track = tracks[index];
  return track === undefined ? undefined : { track, index };
};

/** Bitrate of stereo AAC when audio is converted. */
export const stereoAacKbps = 160;

const assumedCopiedAudioKbps = 192;

const pickEncoder = (
  hardware: HardwareCaps,
): { readonly encoder: Encoder; readonly rateControl: RateControl } => {
  const found = hardware.encoders.find((candidate) => hasCodec(candidate.codecs, "h264"));
  if (found === undefined) return { encoder: "software", rateControl: "vbr" };
  const rateControl = (["vbr", "cbr", "cqp"] as const).find((mode) =>
    found.rateControl.includes(mode),
  );
  return { encoder: found.encoder, rateControl: rateControl ?? "cqp" };
};

const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

/** Everything the decision reads. */
export interface TranscodeContext {
  readonly stream: StreamInfo;
  readonly capabilities: MediaCapabilities;
  readonly quality: QualityRequest;
  readonly network?: NetworkKind | undefined;
  readonly measuredKbps?: number | undefined;
  /** Playback speed; above 1 while catching up. */
  readonly playbackRate?: number | undefined;
  /** Preferred audio language (ISO 639 code as the guide and ffprobe report it). */
  readonly audioLanguage?: string | undefined;
  readonly hardware: HardwareCaps;
}

/**
 * Decides how one playback session is delivered, cheapest first: `direct` when the device plays
 * everything and the bitrate fits; `remux` when only the container does not fit HLS; `audio` when
 * only the audio has to change (MP2 on a browser, passthrough surround while catching up);
 * `video` when the codec, profile or resolution is unsupported, the picture is interlaced and
 * the device cannot deinterlace, or the bitrate is above the quality cap. A converted interlaced
 * picture is always deinterlaced.
 */
export const decideTranscode = (context: TranscodeContext): TranscodePlan => {
  const { stream, capabilities } = context;
  const sourceKbps =
    stream.bitrateKbps ??
    (stream.video === undefined ? 0 : typicalBitrateKbps(stream.video.height)) +
      assumedCopiedAudioKbps;
  const target = resolveQuality(context.quality, { ...context, sourceKbps });
  const reasons: Array<TranscodeReason> = [];

  // Audio first: its bitrate is part of the budget the video gets.
  const chosen = chooseAudio(stream.audio, context.audioLanguage);
  let audio: AudioPlan = { _tag: "None" };
  let audioKbps = 0;
  if (chosen !== undefined) {
    const { track, index } = chosen;
    const passthrough = hasCodec(capabilities.audioPassthrough, track.codec);
    const decodable = hasCodec(capabilities.audio, track.codec);
    const speedChanged = (context.playbackRate ?? 1) !== 1;
    const audioReason: TranscodeReason | undefined =
      passthrough && speedChanged
        ? "catchUpPassthrough"
        : passthrough || decodable
          ? undefined
          : "audioCodecUnsupported";
    if (audioReason === undefined) {
      audio = { _tag: "Copy", trackIndex: index };
      audioKbps = track.bitrateKbps ?? assumedCopiedAudioKbps;
    } else {
      reasons.push(audioReason);
      audio = {
        _tag: "Encode",
        trackIndex: index,
        codec: "aac",
        channels: Math.min(track.channels ?? 2, 2),
        bitrateKbps: stereoAacKbps,
      };
      audioKbps = stereoAacKbps;
    }
  }

  let video: VideoPlan = stream.video === undefined ? { _tag: "None" } : { _tag: "Copy" };
  let quality: QualityLevel = "original";
  const source = stream.video;
  if (source !== undefined) {
    const videoReasons: Array<TranscodeReason> = [];
    const decoders = decodersFor(source, capabilities);
    if (decoders.length === 0) videoReasons.push("videoCodecUnsupported");
    else if (!decoders.some((decoder) => fits(source, decoder))) {
      videoReasons.push("resolutionTooHigh");
    }
    if (source.interlaced && !capabilities.canDeinterlace) videoReasons.push("interlaced");

    const caps = [
      target.bitrateKbps === undefined
        ? undefined
        : { kbps: target.bitrateKbps, reason: target.reason ?? "bandwidth" },
      capabilities.maxBitrateKbps === undefined
        ? undefined
        : { kbps: capabilities.maxBitrateKbps, reason: "bandwidth" as const },
    ].filter((cap) => cap !== undefined);
    const tightest = caps.toSorted((a, b) => a.kbps - b.kbps)[0];
    const overCap = tightest !== undefined && sourceKbps > tightest.kbps * bitrateTolerance;
    if (overCap) videoReasons.push(tightest.reason);

    if (videoReasons.length > 0) {
      reasons.unshift(...videoReasons);
      const h264 = capabilities.video.filter((decoder) => normaliseCodec(decoder.codec) === "h264");
      const maxHeight = Math.min(
        source.height,
        target.maxHeight ?? source.height,
        ...h264.map((decoder) => decoder.maxHeight),
      );
      const maxWidth = Math.min(source.width, ...h264.map((decoder) => decoder.maxWidth));
      const scale = Math.min(1, maxHeight / source.height, maxWidth / source.width);
      const height = even(source.height * scale);
      const totalKbps = Math.min(
        tightest?.kbps ?? Number.POSITIVE_INFINITY,
        typicalBitrateKbps(height) + audioKbps,
      );
      const deinterlace: DeinterlaceMode | undefined = source.interlaced
        ? target.level === "original" || target.level === "high"
          ? "field"
          : "frame"
        : undefined;
      quality = target.level === "original" && overCap ? rungFitting(totalKbps) : target.level;
      video = {
        _tag: "Encode",
        codec: "h264",
        ...pickEncoder(context.hardware),
        bitrateKbps: Math.max(500, Math.round(totalKbps - audioKbps)),
        width: even(source.width * scale),
        height,
        // ffprobe reports the frame rate of interlaced video (25 for 1080i50); one frame per field doubles it.
        fps: deinterlace === "field" && source.fps <= 30 ? source.fps * 2 : source.fps,
        ...(deinterlace === undefined ? {} : { deinterlace }),
      };
    }
  }

  const repackage = !isHlsContainer(stream.container);
  if (repackage) reasons.push("containerUnsupported");

  const decision: TranscodeDecision =
    video._tag === "Encode"
      ? "video"
      : audio._tag === "Encode"
        ? "audio"
        : repackage
          ? "remux"
          : "direct";
  return {
    decision,
    reasons,
    quality,
    video,
    audio,
  };
};
