import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { MediaCapabilities, StreamInfo } from "../src/media.ts";
import {
  automaticPictureConversions,
  decideTranscode,
  type HardwareCaps,
  householdDefaultHint,
  type QualityDefaults,
  qualitySituation,
  sessionQuality,
  isHlsContainer,
  normaliseCodec,
  normaliseProfile,
  pictureConversionChoices,
  pictureConversionCount,
  resolveQuality,
  softwareOnly,
  type TranscodeContext,
  TranscodePlan,
  withOriginalVideo,
} from "../src/transcode.ts";
import { at } from "./test-support.ts";

const probedAt = at("2026-11-21T20:00:00Z");

/** Das Erste HD: 720p50 H.264 with MP2 stereo and AC3 surround, as DVB sends it. */
const dvbHd: StreamInfo = {
  container: "mpegts",
  video: { codec: "h264", profile: "High", width: 1280, height: 720, fps: 50, interlaced: false },
  audio: [
    { codec: "mp2", channels: 2, language: "deu", bitrateKbps: 256 },
    { codec: "ac3", channels: 6, language: "deu", bitrateKbps: 448 },
  ],
  bitrateKbps: 6000,
  probedAt,
};

/** arte HD: 1080i25 H.264 with AAC, the "1080i · Original" badge in the player mockup. */
const interlacedHd: StreamInfo = {
  container: "mpegts",
  video: { codec: "h264", profile: "High", width: 1920, height: 1080, fps: 25, interlaced: true },
  audio: [{ codec: "aac", channels: 2, language: "deu", bitrateKbps: 128 }],
  bitrateKbps: 8000,
  probedAt,
};

const hevcUhd: StreamInfo = {
  container: "mpegts",
  video: {
    codec: "hevc",
    profile: "Main 10",
    width: 3840,
    height: 2160,
    fps: 50,
    interlaced: false,
  },
  audio: [{ codec: "eac3", channels: 6, language: "eng" }],
  bitrateKbps: 20_000,
  probedAt,
};

const chrome: MediaCapabilities = {
  video: [
    { codec: "avc1", profiles: [], maxWidth: 3840, maxHeight: 2160 },
    { codec: "hvc1", profiles: ["Main", "Main 10"], maxWidth: 3840, maxHeight: 2160 },
  ],
  audio: ["mp4a", "mp3", "opus"],
  audioPassthrough: [],
  hdr: false,
  canDeinterlace: false,
};

const firefox: MediaCapabilities = {
  ...chrome,
  video: [{ codec: "avc1", profiles: [], maxWidth: 3840, maxHeight: 2160 }],
};

/** A Shield on an AV receiver: decodes everything, passes AC3/EAC3 through, deinterlaces. */
const shield: MediaCapabilities = {
  video: [
    { codec: "h264", profiles: [], maxWidth: 3840, maxHeight: 2160 },
    { codec: "hevc", profiles: [], maxWidth: 3840, maxHeight: 2160 },
    { codec: "mpeg2video", profiles: [], maxWidth: 1920, maxHeight: 1080 },
  ],
  audio: ["aac", "mp2", "mp3"],
  audioPassthrough: ["ac3", "eac3"],
  hdr: true,
  canDeinterlace: true,
};

const phone: MediaCapabilities = {
  video: [{ codec: "h264", profiles: [], maxWidth: 1920, maxHeight: 1080 }],
  audio: ["aac", "mp2", "mp3", "ac3"],
  audioPassthrough: [],
  hdr: false,
  canDeinterlace: true,
};

const quickSync: HardwareCaps = {
  encoders: [{ encoder: "qsv", codecs: ["h264", "hevc"], rateControl: ["cqp"] }],
};

const decide = (overrides: Partial<TranscodeContext> & Pick<TranscodeContext, "stream">) =>
  decideTranscode({
    capabilities: chrome,
    quality: { _tag: "Auto" },
    network: "lan",
    hardware: quickSync,
    ...overrides,
  });

describe("decideTranscode: the cases from the design doc", () => {
  it("converts only the audio when a browser gets MP2", () => {
    const plan = decide({ stream: dvbHd });
    expect(plan).toEqual({
      decision: "audio",
      reasons: ["audioCodecUnsupported"],
      quality: "original",
      video: { _tag: "Copy" },
      audio: { _tag: "Encode", trackIndex: 0, codec: "aac", channels: 2, bitrateKbps: 192 },
    });
  });

  it("converts HEVC to H.264 for Firefox, on the hardware encoder in its only rate-control mode", () => {
    const plan = decide({ stream: hevcUhd, capabilities: firefox });
    expect(plan.decision).toBe("video");
    expect(plan.reasons).toEqual(["videoCodecUnsupported", "audioCodecUnsupported"]);
    expect(plan.video).toMatchObject({
      _tag: "Encode",
      codec: "h264",
      encoder: "qsv",
      rateControl: "cqp",
      width: 3840,
      height: 2160,
    });
  });

  it("plays HEVC directly where the browser decodes the profile", () => {
    const plan = decide({ stream: { ...hevcUhd, audio: [{ codec: "aac", channels: 2 }] } });
    expect(plan.decision).toBe("direct");
  });

  it("deinterlaces 1080i on a browser to 50 frames per second", () => {
    const plan = decide({ stream: interlacedHd });
    expect(plan.decision).toBe("video");
    expect(plan.reasons).toEqual(["interlaced"]);
    expect(plan.video).toMatchObject({
      _tag: "Encode",
      width: 1920,
      height: 1080,
      fps: 50,
      deinterlace: "field",
    });
    expect(plan.audio).toEqual({ _tag: "Copy", trackIndex: 0 });
  });

  it("leaves interlaced video alone on a device that deinterlaces", () => {
    expect(decide({ stream: interlacedHd, capabilities: shield }).decision).toBe("direct");
  });

  it("caps a phone on mobile data at Medium 4 Mbit/s, 720p, and says why", () => {
    const plan = decide({ stream: interlacedHd, capabilities: phone, network: "mobile" });
    expect(plan.decision).toBe("video");
    expect(plan.reasons).toEqual(["mobileData"]);
    expect(plan.quality).toBe("medium");
    expect(plan.video).toMatchObject({
      _tag: "Encode",
      width: 1280,
      height: 720,
      // Medium halves the frame rate to save bits.
      fps: 25,
      deinterlace: "frame",
      bitrateKbps: 4000 - 128,
    });
  });

  it("does not convert on mobile data when the original already fits", () => {
    const plan = decide({
      stream: { ...dvbHd, bitrateKbps: 3500 },
      capabilities: phone,
      network: "mobile",
    });
    expect(plan.decision).toBe("direct");
  });

  it("converts passthrough AC3 to stereo while catching up, and passes it through at 1x", () => {
    const surround = { ...dvbHd, audio: [dvbHd.audio[1]!] };
    expect(decide({ stream: surround, capabilities: shield }).decision).toBe("direct");
    const plan = decide({ stream: surround, capabilities: shield, playbackRate: 1.5 });
    expect(plan).toMatchObject({
      decision: "audio",
      reasons: ["catchUpPassthrough"],
      video: { _tag: "Copy" },
      audio: { _tag: "Encode", codec: "aac", channels: 2 },
    });
  });
});

describe("decideTranscode: other paths", () => {
  it("picks the audio track in the wanted language", () => {
    const plan = decide({
      stream: {
        ...dvbHd,
        audio: [
          { codec: "aac", language: "deu" },
          { codec: "aac", language: "eng" },
        ],
      },
      audioLanguage: "ENG",
    });
    expect(plan.audio).toEqual({ _tag: "Copy", trackIndex: 1 });
  });

  it("only repackages an imported Matroska file", () => {
    const plan = decide({
      stream: { ...dvbHd, container: "matroska,webm", audio: [{ codec: "aac" }] },
    });
    expect(plan.decision).toBe("remux");
    expect(plan.reasons).toEqual(["containerUnsupported"]);
  });

  it("scales a 4K stream down for a 1080p device", () => {
    const plan = decide({
      stream: { ...hevcUhd, video: { ...hevcUhd.video!, codec: "h264", profile: "High" } },
      capabilities: phone,
    });
    expect(plan.reasons[0]).toBe("resolutionTooHigh");
    expect(plan.video).toMatchObject({ width: 1920, height: 1080 });
  });

  it("honours an explicit bitrate and reports the requested quality", () => {
    const plan = decide({
      stream: interlacedHd,
      capabilities: shield,
      quality: { _tag: "Bitrate", kbps: 2000 },
    });
    expect(plan.reasons).toEqual(["requestedQuality"]);
    expect(plan.quality).toBe("dataSaver");
    expect(plan.video).toMatchObject({ height: 540, bitrateKbps: 2000 - 128 });
  });

  it("keeps the original when asked, even on mobile data", () => {
    const plan = decide({
      stream: dvbHd,
      capabilities: phone,
      network: "mobile",
      quality: { _tag: "Original" },
    });
    expect(plan.decision).toBe("direct");
  });

  it("steps down when the measured throughput is low, even at home", () => {
    const plan = decide({ stream: interlacedHd, capabilities: shield, measuredKbps: 6000 });
    expect(plan.reasons).toEqual(["bandwidth"]);
    expect(plan.quality).toBe("medium");
  });

  it("falls back to software with a bitrate target when there is no hardware encoder", () => {
    const plan = decide({ stream: hevcUhd, capabilities: firefox, hardware: softwareOnly });
    expect(plan.video).toMatchObject({ encoder: "software", rateControl: "vbr" });
  });

  it("produces plans that encode with the wire schema", () => {
    const plan = decide({ stream: interlacedHd, capabilities: phone, network: "mobile" });
    const encoded = Schema.encodeSync(TranscodePlan)(plan);
    expect(Schema.decodeUnknownSync(TranscodePlan)(encoded)).toEqual(plan);
  });

  it("handles radio: no video track", () => {
    const plan = decide({
      stream: { container: "mpegts", audio: [{ codec: "mp2" }], probedAt },
    });
    expect(plan).toMatchObject({ decision: "audio", video: { _tag: "None" } });
  });
});

describe("resolveQuality", () => {
  it("uses the situation defaults for Auto", () => {
    expect(resolveQuality({ _tag: "Auto" }, { network: "lan" }).level).toBe("original");
    expect(resolveQuality({ _tag: "Auto" }, { network: "remote" })).toEqual({
      level: "high",
      bitrateKbps: 8000,
      maxHeight: 1080,
      reason: "bandwidth",
    });
    expect(resolveQuality({ _tag: "Auto" }, { network: "mobile" }).bitrateKbps).toBe(4000);
  });

  it("keeps the original at home when the throughput carries it", () => {
    expect(
      resolveQuality({ _tag: "Auto" }, { network: "lan", measuredKbps: 20_000, sourceKbps: 8000 }),
    ).toEqual({ level: "original" });
    expect(
      resolveQuality({ _tag: "Auto" }, { network: "lan", measuredKbps: 3000, sourceKbps: 8000 })
        .level,
    ).toBe("dataSaver");
  });
});

describe("device quality and the household default", () => {
  const defaults: QualityDefaults = { home: "original", away: "auto", mobile: "2000" };

  it("tells mobile data, away and home apart", () => {
    expect(qualitySituation({ network: "mobile", away: true })).toBe("mobile");
    expect(qualitySituation({ network: "remote" })).toBe("away");
    expect(qualitySituation({ network: "lan", away: true })).toBe("away");
    expect(qualitySituation({ network: "wifi" })).toBe("home");
    expect(qualitySituation({})).toBe("home");
  });

  it("keeps a device's own choice and fills the household default in for auto", () => {
    expect(sessionQuality("4000", defaults, "home")).toBe("4000");
    expect(sessionQuality("original", defaults, "mobile")).toBe("original");
    expect(sessionQuality("auto", defaults, "home")).toBe("original");
    expect(sessionQuality("auto", defaults, "mobile")).toBe("2000");
    // The household's own "auto" stays automatic: resolveQuality picks by network and throughput.
    expect(sessionQuality("auto", defaults, "away")).toBe("auto");
  });

  it("hints one quality where the device can tell, home and away where it cannot", () => {
    expect(householdDefaultHint(defaults, "mobile")).toEqual({ _tag: "One", quality: "2000" });
    expect(householdDefaultHint(defaults, "remote")).toEqual({ _tag: "One", quality: "auto" });
    expect(householdDefaultHint(defaults, "lan")).toEqual({
      _tag: "HomeOrAway",
      home: "original",
      away: "auto",
    });
    expect(householdDefaultHint({ ...defaults, away: "original" }, undefined)).toEqual({
      _tag: "One",
      quality: "original",
    });
  });
});

describe("codec names", () => {
  it("maps client and ffprobe spellings to one name", () => {
    expect(normaliseCodec("avc1.640028")).toBe("h264");
    expect(normaliseCodec("H.264")).toBe("h264");
    expect(normaliseCodec("hev1.2.4.L153")).toBe("hevc");
    expect(normaliseCodec("ac-3")).toBe("ac3");
    expect(normaliseCodec("mp4a.40.2")).toBe("aac");
    expect(normaliseCodec("mpeg2video")).toBe("mpeg2video");
  });

  it("reads H.264's constrained profiles as the profile they are a subset of", () => {
    expect(normaliseProfile("Constrained Baseline")).toBe("baseline");
    expect(normaliseProfile("Progressive High")).toBe("high");
    expect(normaliseProfile("Main 10")).toBe("main10");
    const baseline: StreamInfo = {
      ...dvbHd,
      video: { ...dvbHd.video!, profile: "Constrained Baseline" },
      audio: [{ codec: "aac", channels: 2 }],
    };
    const browser: MediaCapabilities = {
      ...chrome,
      video: [
        { codec: "h264", profiles: ["high", "main", "baseline"], maxWidth: 1920, maxHeight: 1080 },
      ],
    };
    expect(decide({ stream: baseline, capabilities: browser }).decision).toBe("direct");
  });

  it("knows which containers HLS carries", () => {
    expect(isHlsContainer("mpegts")).toBe(true);
    expect(isHlsContainer("mov,mp4,m4a,3gp,3g2,mj2")).toBe(false);
  });
});

describe("withOriginalVideo: the converter is busy", () => {
  it("plays the original picture when the video converts only for a bitrate cap", () => {
    const plan = decide({ stream: dvbHd, network: "mobile" });
    expect(plan.video._tag).toBe("Encode");
    expect(withOriginalVideo(plan)).toEqual({
      decision: "audio",
      reasons: ["audioCodecUnsupported"],
      quality: "original",
      video: { _tag: "Copy" },
      audio: plan.audio,
    });
  });

  it("plays it directly when nothing else converts", () => {
    const plan = decide({ stream: interlacedHd, capabilities: phone, network: "mobile" });
    expect(plan.reasons).toEqual(["mobileData"]);
    expect(withOriginalVideo(plan)).toMatchObject({ decision: "direct", reasons: [] });
  });

  it("has no fallback when the device cannot show the original picture", () => {
    expect(withOriginalVideo(decide({ stream: hevcUhd, capabilities: firefox }))).toBeUndefined();
    expect(withOriginalVideo(decide({ stream: interlacedHd }))).toBeUndefined();
  });

  it("leaves a plan that copies the video alone", () => {
    const plan = decide({ stream: dvbHd });
    expect(withOriginalVideo(plan)).toBe(plan);
  });
});

describe("simultaneous picture conversions", () => {
  it("offers no limit, automatic, then 1 to 10", () => {
    expect(pictureConversionChoices).toEqual([
      "unlimited",
      "auto",
      ...Array.from({ length: 10 }, (_, index) => String(index + 1)),
    ]);
  });

  it("sets no limit by default", () => {
    expect(pictureConversionCount("unlimited", "software", 4)).toBeUndefined();
    expect(pictureConversionCount("unlimited", "nvenc", 4)).toBeUndefined();
  });

  it("counts automatically by encoder: six on Quick Sync and VA-API, three on NVENC", () => {
    expect(automaticPictureConversions("qsv", 2)).toBe(6);
    expect(automaticPictureConversions("vaapi", 2)).toBe(6);
    expect(automaticPictureConversions("nvenc", 32)).toBe(3);
    expect(pictureConversionCount("auto", "qsv", 2)).toBe(6);
  });

  it("allows one software conversion per four cores, at least one", () => {
    expect(automaticPictureConversions("software", 16)).toBe(4);
    expect(automaticPictureConversions("software", 7)).toBe(1);
    expect(automaticPictureConversions("software", 2)).toBe(1);
  });

  it("takes a fixed number whatever the encoder", () => {
    expect(pictureConversionCount("1", "qsv", 16)).toBe(1);
    expect(pictureConversionCount("10", "software", 2)).toBe(10);
  });
});
