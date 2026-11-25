import type { MediaCapabilities } from "@slipstream/domain";

/** MSE codec strings to probe, by the codec name the server reports from ffprobe. */
const VIDEO_PROBES = [
  {
    codec: "h264",
    profiles: ["high", "main", "baseline"],
    mime: 'video/mp4; codecs="avc1.640028"',
  },
  { codec: "hevc", profiles: ["main", "main10"], mime: 'video/mp4; codecs="hvc1.1.6.L120.90"' },
  { codec: "av1", profiles: ["main"], mime: 'video/mp4; codecs="av01.0.08M.08"' },
] as const;

const AUDIO_PROBES = [
  { codec: "aac", mime: 'audio/mp4; codecs="mp4a.40.2"' },
  { codec: "mp3", mime: 'audio/mp4; codecs="mp4a.40.34"' },
  { codec: "ac3", mime: 'audio/mp4; codecs="ac-3"' },
  { codec: "eac3", mime: 'audio/mp4; codecs="ec-3"' },
  { codec: "opus", mime: 'audio/mp4; codecs="opus"' },
] as const;

/** What the browser can tell about itself, so the probe stays testable. */
export interface BrowserMedia {
  readonly isTypeSupported: (mime: string) => boolean;
  readonly screen: { readonly width: number; readonly height: number };
  readonly hdr: boolean;
}

/**
 * What this browser can decode, for the playback session (PLAN 6.11): the server picks direct
 * play, remux or conversion from it. hls.js plays through Media Source Extensions, so MSE's
 * answer is the one that counts. Browsers never deinterlace or pass audio through.
 */
export const probeCapabilities = (media: BrowserMedia): MediaCapabilities => {
  // Decoders handle 4K when the screen is big enough to want it; the server keeps 1080p50
  // otherwise, which every desktop browser decodes.
  const big = Math.max(media.screen.width, media.screen.height) > 1920;
  return {
    video: VIDEO_PROBES.filter((probe) => media.isTypeSupported(probe.mime)).map((probe) => ({
      codec: probe.codec,
      profiles: [...probe.profiles],
      maxWidth: big ? 3840 : 1920,
      maxHeight: big ? 2160 : 1080,
    })),
    audio: AUDIO_PROBES.filter((probe) => media.isTypeSupported(probe.mime)).map(
      (probe) => probe.codec,
    ),
    audioPassthrough: [],
    hdr: media.hdr,
    canDeinterlace: false,
  };
};

/** The probe against the real browser. */
export const browserCapabilities = (): MediaCapabilities =>
  probeCapabilities({
    isTypeSupported: (mime) =>
      typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime),
    screen: {
      width: window.screen.width * window.devicePixelRatio,
      height: window.screen.height * window.devicePixelRatio,
    },
    hdr: window.matchMedia("(dynamic-range: high)").matches,
  });
