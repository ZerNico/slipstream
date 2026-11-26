import { TranscodePlan } from "@slipstream/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { statsRows, type StatsSample } from "./stats.ts";

const empty: StatsSample = {
  videoSize: undefined,
  tracks: [],
  plan: undefined,
  networkBitrate: undefined,
  position: undefined,
};

const labels = (sample: StatsSample) => statsRows(sample).map(([label]) => label);

describe("statsRows", () => {
  it("always says how the stream is delivered, and leaves out what is not known", () => {
    expect(statsRows(empty)).toEqual([["Delivery", "Direct"]]);
  });

  it("reads the picture, codecs and bitrates from the playing track", () => {
    const rows = statsRows({
      ...empty,
      videoSize: { width: 1920, height: 1080 },
      tracks: [
        { codecs: "hvc1", width: 3840, height: 2160, bitrate: 16_000_000, selected: false },
        { codecs: "avc1.640028", width: 1920, height: 1080, bitrate: 6_000_000, selected: true },
      ],
      networkBitrate: 48_000_000,
      position: { currentTime: 100, playableDuration: 112.34 },
    });
    expect(rows.map(([label]) => label)).toEqual([
      "Video",
      "Codecs",
      "Delivery",
      "Stream",
      "Network",
      "Buffer",
    ]);
    expect(rows[0]?.[1]).toBe("1920×1080");
    expect(rows[1]?.[1]).toBe("avc1.640028");
    expect(rows[3]?.[1]).toMatch(/^6/u);
    expect(rows[5]?.[1]).toBe("12.3 s");
  });

  it("falls back to the only track's size, and never shows a buffer below zero", () => {
    const rows = statsRows({
      ...empty,
      tracks: [{ width: 1280, height: 720 }],
      position: { currentTime: 50, playableDuration: 40 },
    });
    expect(rows[0]).toEqual(["Video", "1280×720"]);
    expect(rows.at(-1)).toEqual(["Buffer", "0 s"]);
  });

  it("names the encoder when the server converts the picture", () => {
    const sample: StatsSample = {
      ...empty,
      plan: Schema.decodeUnknownSync(TranscodePlan)({
        decision: "video",
        reasons: ["bandwidth"],
        quality: "high",
        video: {
          _tag: "Encode",
          codec: "h264",
          encoder: "qsv",
          rateControl: "vbr",
          bitrateKbps: 8000,
          width: 1920,
          height: 1080,
          fps: 25,
        },
        audio: { _tag: "Copy", trackIndex: 0 },
      }),
    };
    expect(statsRows(sample)).toEqual([["Delivery", "Converted · Intel Quick Sync"]]);
    expect(labels(empty)).toEqual(["Delivery"]);
  });
});
