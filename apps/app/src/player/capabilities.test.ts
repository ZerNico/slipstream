import { decideTranscode, type StreamInfo, softwareOnly } from "@slipstream/domain";
import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { assumedCapabilities, capabilitiesFrom, type NativeMediaReport } from "./capabilities.ts";

/** A phone: H.264 and HEVC in hardware, AAC and MP3, no AC-3 decoder, the speaker takes nothing. */
const phone: NativeMediaReport = {
  video: [
    { mime: "video/avc", profiles: ["Baseline", "High", "Main"], maxWidth: 4096, maxHeight: 2176 },
    { mime: "video/hevc", profiles: ["Main", "Main 10"], maxWidth: 4096, maxHeight: 2176 },
    { mime: "video/x-vnd.on2.vp8", profiles: [], maxWidth: 1920, maxHeight: 1088 },
  ],
  audio: ["audio/3gpp", "audio/mp4a-latm", "audio/mpeg", "audio/opus", "audio/raw"],
  passthrough: [],
  hdr: false,
};

/** A Shield on an AV receiver: decodes AC-3 too, and the HDMI sink takes Dolby and DTS. */
const shield: NativeMediaReport = {
  video: [
    { mime: "video/avc", profiles: ["High", "Main"], maxWidth: 4096, maxHeight: 2160 },
    { mime: "video/mpeg2", profiles: ["Main", "Simple"], maxWidth: 1920, maxHeight: 1088 },
  ],
  audio: ["audio/ac3", "audio/eac3", "audio/eac3-joc", "audio/mp4a-latm", "audio/mpeg-L2"],
  passthrough: ["ac3", "eac3", "dts"],
  hdr: true,
};

/** A German private HD channel: 1080i H.264 with AC-3 stereo. */
const privateHd: StreamInfo = {
  container: "mpegts",
  video: { codec: "h264", profile: "High", width: 1920, height: 1080, fps: 25, interlaced: true },
  audio: [{ codec: "ac3", channels: 2, bitrateKbps: 192 }],
  bitrateKbps: 8000,
  probedAt: DateTime.makeUnsafe(0),
};

const decide = (report: NativeMediaReport | undefined, playbackRate = 1) =>
  decideTranscode({
    stream: privateHd,
    capabilities: capabilitiesFrom(report),
    quality: { _tag: "Original" },
    playbackRate,
    hardware: softwareOnly,
  });

describe("capabilitiesFrom", () => {
  it("names a phone's decoders as the server does and drops what it does not know", () => {
    expect(capabilitiesFrom(phone)).toEqual({
      video: [
        { codec: "h264", profiles: ["Baseline", "High", "Main"], maxWidth: 4096, maxHeight: 2176 },
        { codec: "hevc", profiles: ["Main", "Main 10"], maxWidth: 4096, maxHeight: 2176 },
      ],
      audio: ["aac", "mp3", "opus"],
      audioPassthrough: [],
      hdr: false,
      canDeinterlace: true,
    });
  });

  it("reports what a TV's HDMI sink passes through, and each codec once", () => {
    const capabilities = capabilitiesFrom(shield);
    expect(capabilities.audio).toEqual(["ac3", "eac3", "aac", "mp2"]);
    expect(capabilities.audioPassthrough).toEqual(["ac3", "eac3", "dts"]);
    expect(capabilities.video.map((decoder) => decoder.codec)).toEqual(["h264", "mpeg2video"]);
    expect(capabilities.hdr).toBe(true);
  });

  it("assumes the conservative set without the native probe", () => {
    expect(capabilitiesFrom(undefined)).toBe(assumedCapabilities);
  });
});

describe("what the server decides from it", () => {
  it("converts AC-3 to AAC for a phone without an AC-3 decoder", () => {
    expect(decide(phone)).toMatchObject({ decision: "audio", reasons: ["audioCodecUnsupported"] });
  });

  it("passes AC-3 through to a receiver, and converts it only while catching up", () => {
    expect(decide(shield).decision).toBe("direct");
    expect(decide(shield, 1.5)).toMatchObject({
      decision: "audio",
      reasons: ["catchUpPassthrough"],
    });
  });
});
