import type { MediaCapabilities } from "@slipstream/domain";

/**
 * What the native probe (modules/media-capabilities, MediaCapabilitiesModule.kt) reports:
 * MediaCodec decoders by MIME type, and the audio formats the current audio route passes
 * through, already by codec name.
 */
export interface NativeMediaReport {
  readonly video: ReadonlyArray<{
    readonly mime: string;
    readonly profiles: ReadonlyArray<string>;
    readonly maxWidth: number;
    readonly maxHeight: number;
  }>;
  readonly audio: ReadonlyArray<string>;
  readonly passthrough: ReadonlyArray<string>;
  readonly hdr: boolean;
}

/** Decoder MIME types (as MediaCodec lists them, lower-cased) by the codec names ffprobe uses. */
const videoCodecs: Readonly<Record<string, string>> = {
  "video/avc": "h264",
  "video/hevc": "hevc",
  "video/mpeg2": "mpeg2video",
  "video/av01": "av1",
  "video/x-vnd.on2.vp9": "vp9",
};

const audioCodecs: Readonly<Record<string, string>> = {
  "audio/mp4a-latm": "aac",
  "audio/mpeg": "mp3",
  "audio/mpeg-l2": "mp2",
  "audio/ac3": "ac3",
  "audio/eac3": "eac3",
  "audio/eac3-joc": "eac3",
  "audio/opus": "opus",
  "audio/vnd.dts": "dts",
  "audio/vnd.dts.hd": "dts",
  "audio/true-hd": "truehd",
};

/**
 * What an Android device without the native probe is assumed to decode (Expo Go, tests): H.264
 * up to 1080p, HEVC, AAC and MP3. AC-3 is left out on purpose so the server converts it to AAC
 * rather than risk a silent picture.
 */
export const assumedCapabilities: MediaCapabilities = {
  video: [
    { codec: "h264", profiles: ["baseline", "main", "high"], maxWidth: 1920, maxHeight: 1080 },
    { codec: "hevc", profiles: ["main"], maxWidth: 1920, maxHeight: 1080 },
  ],
  audio: ["aac", "mp3"],
  audioPassthrough: [],
  hdr: false,
  canDeinterlace: true,
};

const known = (names: ReadonlyArray<string | undefined>): string[] => [
  ...new Set(names.filter((name): name is string => name !== undefined)),
];

/**
 * The capabilities a session reports, from the native probe; the assumed ones without it.
 * A phone without an AC-3 decoder gets AAC from the server; a TV on a receiver that takes AC-3
 * passes it through. Android's decoders hand the player progressive frames, so the device counts
 * as deinterlacing (only real hardware can say otherwise).
 */
export const capabilitiesFrom = (report: NativeMediaReport | undefined): MediaCapabilities => {
  if (report === undefined) return assumedCapabilities;
  const video = report.video.flatMap((decoder) => {
    const codec = videoCodecs[decoder.mime.toLowerCase()];
    return codec === undefined || decoder.maxWidth < 1 || decoder.maxHeight < 1
      ? []
      : [
          {
            codec,
            profiles: [...decoder.profiles],
            maxWidth: decoder.maxWidth,
            maxHeight: decoder.maxHeight,
          },
        ];
  });
  return {
    video,
    audio: known(report.audio.map((mime) => audioCodecs[mime.toLowerCase()])),
    audioPassthrough: known([...report.passthrough]),
    hdr: report.hdr,
    canDeinterlace: true,
  };
};
