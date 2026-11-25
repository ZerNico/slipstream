/**
 * A conversion variant: what ffmpeg does to the video and the audio of every segment of a
 * converting session (`decideTranscode`'s video and audio plans), as a short, URL-safe name.
 * The name sits in the playlist path (`/hls/live/<channel>/<variant>.m3u8`, so another variant
 * is another playlist and players load it afresh) and in the signed segment tokens, and names
 * the converted segments' cache directory. A session that converts nothing has no variant and
 * plays the original segments.
 *
 *     copy_aac-0-2-192                          video copied, audio track 0 to stereo AAC 192k
 *     h264-qsv-cqp-4000-1280-720-50000-field_copy  video to 720p50 H.264 on Quick Sync
 */
import type {
  AudioPlan,
  DeinterlaceMode,
  Encoder,
  RateControl,
  TranscodePlan,
  VideoPlan,
} from "@slipstream/domain";

/** The part of a plan that decides the bytes of a converted segment. */
export interface Variant {
  readonly video: VideoPlan;
  readonly audio: AudioPlan;
}

const encoders: ReadonlyArray<Encoder> = ["software", "qsv", "vaapi", "nvenc"];
const rateControls: ReadonlyArray<RateControl> = ["vbr", "cbr", "cqp"];
const deinterlaceModes: ReadonlyArray<DeinterlaceMode> = ["field", "frame"];

const videoName = (video: VideoPlan): string => {
  switch (video._tag) {
    case "None":
      return "none";
    case "Copy":
      return "copy";
    case "Encode":
      return [
        video.codec,
        video.encoder,
        video.rateControl,
        video.bitrateKbps,
        video.width,
        video.height,
        Math.round(video.fps * 1000),
        video.deinterlace ?? "p",
      ].join("-");
  }
};

const audioName = (audio: AudioPlan): string => {
  switch (audio._tag) {
    case "None":
      return "none";
    case "Copy":
      return "copy";
    case "Encode":
      return [audio.codec, audio.trackIndex, audio.channels, audio.bitrateKbps].join("-");
  }
};

/** Whether a plan converts anything per segment (direct and remux plans do not). */
export const converts = (variant: Variant): boolean =>
  variant.video._tag === "Encode" || variant.audio._tag === "Encode";

/** The variant name of a plan; `undefined` when it converts nothing. */
export const variantName = (plan: Pick<TranscodePlan, "video" | "audio">): string | undefined =>
  converts(plan) ? `${videoName(plan.video)}_${audioName(plan.audio)}` : undefined;

const int = (text: string | undefined, min: number): number | undefined => {
  if (text === undefined || !/^\d{1,9}$/.test(text)) return undefined;
  const value = Number(text);
  return value >= min ? value : undefined;
};

const parseVideo = (text: string): VideoPlan | undefined => {
  if (text === "none") return { _tag: "None" };
  if (text === "copy") return { _tag: "Copy" };
  const [codec, encoder, rateControl, kbps, width, height, fps, deinterlace, ...rest] =
    text.split("-");
  const bitrateKbps = int(kbps, 1);
  const w = int(width, 2);
  const h = int(height, 2);
  const milli = int(fps, 1);
  const enc = encoders.find((candidate) => candidate === encoder);
  const rc = rateControls.find((candidate) => candidate === rateControl);
  const mode = deinterlaceModes.find((candidate) => candidate === deinterlace);
  if (
    codec !== "h264" ||
    rest.length > 0 ||
    enc === undefined ||
    rc === undefined ||
    bitrateKbps === undefined ||
    w === undefined ||
    h === undefined ||
    milli === undefined ||
    (mode === undefined && deinterlace !== "p")
  ) {
    return undefined;
  }
  return {
    _tag: "Encode",
    codec,
    encoder: enc,
    rateControl: rc,
    bitrateKbps,
    width: w,
    height: h,
    fps: milli / 1000,
    ...(mode === undefined ? {} : { deinterlace: mode }),
  };
};

const parseAudio = (text: string): AudioPlan | undefined => {
  if (text === "none") return { _tag: "None" };
  // A copied audio keeps every track; the index only matters for a converted one.
  if (text === "copy") return { _tag: "Copy", trackIndex: 0 };
  const [codec, track, channels, kbps, ...rest] = text.split("-");
  const trackIndex = int(track, 0);
  const count = int(channels, 1);
  const bitrateKbps = int(kbps, 1);
  if (
    codec !== "aac" ||
    rest.length > 0 ||
    trackIndex === undefined ||
    count === undefined ||
    count > 2 ||
    bitrateKbps === undefined
  ) {
    return undefined;
  }
  return { _tag: "Encode", trackIndex, codec, channels: count, bitrateKbps };
};

/** The variant a name stands for; `undefined` for anything `variantName` does not write. */
export const parseVariant = (name: string): Variant | undefined => {
  const [video, audio, ...rest] = name.split("_");
  if (video === undefined || audio === undefined || rest.length > 0) return undefined;
  const parsed = { video: parseVideo(video), audio: parseAudio(audio) };
  if (parsed.video === undefined || parsed.audio === undefined) return undefined;
  const variant = { video: parsed.video, audio: parsed.audio };
  return converts(variant) && variantName(variant) === name ? variant : undefined;
};
