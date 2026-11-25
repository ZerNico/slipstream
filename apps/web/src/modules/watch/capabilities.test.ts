import { describe, expect, it } from "vitest";
import { probeCapabilities } from "./capabilities.ts";

const supports =
  (...codecs: string[]) =>
  (mime: string) =>
    codecs.some((codec) => mime.includes(codec));

describe("probeCapabilities", () => {
  it("reports what Media Source Extensions can decode, never passthrough or deinterlacing", () => {
    const caps = probeCapabilities({
      isTypeSupported: supports("avc1", "mp4a.40.2", "ec-3"),
      screen: { width: 1920, height: 1080 },
      hdr: false,
    });
    expect(caps.video.map((decoder) => decoder.codec)).toEqual(["h264"]);
    expect(caps.video[0]).toMatchObject({ maxWidth: 1920, maxHeight: 1080 });
    expect(caps.audio).toEqual(["aac", "eac3"]);
    expect(caps.audioPassthrough).toEqual([]);
    expect(caps.canDeinterlace).toBe(false);
  });

  it("allows 4K on big screens and passes HDR through", () => {
    const caps = probeCapabilities({
      isTypeSupported: supports("avc1", "hvc1"),
      screen: { width: 3840, height: 2160 },
      hdr: true,
    });
    expect(caps.video.map((decoder) => [decoder.codec, decoder.maxWidth])).toEqual([
      ["h264", 3840],
      ["hevc", 3840],
    ]);
    expect(caps.hdr).toBe(true);
  });
});
