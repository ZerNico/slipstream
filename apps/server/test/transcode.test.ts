import { describe, expect, it } from "vitest";
import {
  audioWindow,
  parseSegmentProbe,
  probeArgs,
  segmentArgs,
  type SegmentJob,
} from "../src/transcode/args.ts";
import { pictureJobSlots, UNLIMITED_HARDWARE_JOBS } from "../src/transcode/service.ts";
import { parseVariant, variantName, type Variant } from "../src/transcode/variant.ts";

const aacStereo = {
  _tag: "Encode",
  trackIndex: 0,
  codec: "aac",
  channels: 2,
  bitrateKbps: 192,
} as const;

const audioOnly: Variant = { video: { _tag: "Copy" }, audio: aacStereo };

const field720p: Variant = {
  video: {
    _tag: "Encode",
    codec: "h264",
    encoder: "software",
    rateControl: "vbr",
    bitrateKbps: 3808,
    width: 1280,
    height: 720,
    fps: 50,
    deinterlace: "field",
  },
  audio: { _tag: "Copy", trackIndex: 0 },
};

/** The value following a flag. */
const flag = (args: ReadonlyArray<string>, name: string) => args[args.indexOf(name) + 1];

describe("conversion variants", () => {
  it("names a plan by what it does to video and audio, and reads the name back", () => {
    expect(variantName(audioOnly)).toBe("copy_aac-0-2-192");
    expect(variantName(field720p)).toBe("h264-software-vbr-3808-1280-720-50000-field_copy");
    for (const variant of [audioOnly, field720p]) {
      expect(parseVariant(variantName(variant) ?? "")).toEqual(variant);
    }
  });

  it("keeps a fractional frame rate and a second audio track", () => {
    const variant: Variant = {
      video: { ...field720p.video, fps: 29.97 } as Variant["video"],
      audio: { ...aacStereo, trackIndex: 1, channels: 1, bitrateKbps: 96 },
    };
    const name = variantName(variant) ?? "";
    expect(name).toBe("h264-software-vbr-3808-1280-720-29970-field_aac-1-1-96");
    expect(parseVariant(name)).toEqual(variant);
  });

  it("has no variant for a plan that converts nothing", () => {
    expect(variantName({ video: { _tag: "Copy" }, audio: { _tag: "Copy", trackIndex: 0 } })).toBe(
      undefined,
    );
    expect(parseVariant("copy_copy")).toBeUndefined();
  });

  it("refuses names it does not write", () => {
    for (const name of [
      "",
      "copy",
      "copy_aac-0-6-192",
      "copy_aac-0-2-192_x",
      "copy_mp3-0-2-192",
      "h264-gpu-vbr-1-2-2-25000-p_copy",
      "h264-software-vbr-0-2-2-25000-p_copy",
      "copy_aac-00-2-192",
    ]) {
      expect(parseVariant(name)).toBeUndefined();
    }
  });
});

describe("the audio frame grid", () => {
  // Packet times of two neighbouring stored segments (90 kHz), as ffprobe reports them.
  const first = { startPts: 667_440, endPts: 1_208_880 };
  const second = { startPts: 1_208_880, endPts: 1_748_400 };

  it("keeps whole 1024-sample frames, handing over two frames before the next grid point", () => {
    expect(audioWindow(first, true)).toEqual({
      encodeFrom: 350_208,
      keepFrom: 354_304,
      keepUntil: 643_072,
    });
    const window = audioWindow(first, true);
    for (const value of Object.values(window)) expect(value % 1024).toBe(0);
  });

  it("hands over on the same frame its neighbour starts on", () => {
    expect(audioWindow(second, true).keepFrom).toBe(audioWindow(first, true).keepUntil);
  });

  it("starts a run's first segment cold on its first whole frame", () => {
    expect(audioWindow(first, false)).toEqual({
      encodeFrom: 356_352,
      keepFrom: 356_352,
      keepUntil: 643_072,
    });
  });
});

const job = (overrides: Partial<SegmentJob>): SegmentJob => ({
  segment: "/data/cap/12.ts",
  lookback: "/data/cap/11.ts",
  variant: audioOnly,
  probe: {
    audio: { startPts: 667_440, endPts: 1_208_880 },
    video: { startPts: 666_480, openGop: false },
  },
  output: "/cache/out.ts",
  ...overrides,
});

describe("segment conversion arguments", () => {
  it("copies the picture and converts the audio on the shared grid, warmed up by the previous segment", () => {
    const args = segmentArgs(job({}));
    expect(args.slice(0, 5)).toEqual(["-hide_banner", "-nostdin", "-loglevel", "error", "-copyts"]);
    expect(args.filter((_, index) => args[index - 1] === "-i")).toEqual([
      "/data/cap/12.ts",
      "concat:/data/cap/11.ts|/data/cap/12.ts",
    ]);
    expect(flag(args, "-filter_complex")).toBe("[1:a:0]aresample=48000,atrim=start_pts=350208[a]");
    expect(args.filter((_, index) => args[index - 1] === "-map")).toEqual(["0:v:0?", "[a]"]);
    expect(flag(args, "-c:v")).toBe("copy");
    expect(flag(args, "-c:a")).toBe("aac");
    expect(flag(args, "-b:a")).toBe("192k");
    expect(flag(args, "-ac")).toBe("2");
    expect(flag(args, "-ar")).toBe("48000");
    expect(flag(args, "-bsf:a")).toBe("noise=drop='lt(pts\\,354304)+gte(pts\\,643072)'");
    expect(args.slice(-8)).toEqual([
      "-f",
      "mpegts",
      "-muxdelay",
      "0",
      "-muxpreload",
      "0",
      "-y",
      "/cache/out.ts",
    ]);
  });

  it("converts a run's first segment from itself alone", () => {
    const args = segmentArgs(job({ lookback: undefined }));
    expect(args.filter((_, index) => args[index - 1] === "-i")).toEqual(["/data/cap/12.ts"]);
    expect(flag(args, "-filter_complex")).toBe("[0:a:0]aresample=48000,atrim=start_pts=356352[a]");
  });

  it("converts the chosen audio track only", () => {
    const args = segmentArgs(
      job({ variant: { video: { _tag: "Copy" }, audio: { ...aacStereo, trackIndex: 1 } } }),
    );
    expect(flag(args, "-filter_complex")).toContain("[1:a:1]");
  });

  it("deinterlaces to one frame per field, scales and encodes with x264, keeping all audio", () => {
    const args = segmentArgs(job({ variant: field720p }));
    expect(args.filter((_, index) => args[index - 1] === "-i")).toEqual(["/data/cap/12.ts"]);
    expect(flag(args, "-filter_complex")).toBe(
      "[0:v:0]bwdif=mode=send_field:deint=all,scale=1280:720,format=yuv420p[v]",
    );
    expect(args.filter((_, index) => args[index - 1] === "-map")).toEqual(["[v]", "0:a?"]);
    expect(flag(args, "-c:v")).toBe("libx264");
    expect(flag(args, "-preset")).toBe("veryfast");
    expect(flag(args, "-b:v")).toBe("3808k");
    expect(flag(args, "-maxrate")).toBe("5712k");
    expect(flag(args, "-g")).toBe("100");
    expect(flag(args, "-fps_mode")).toBe("passthrough");
    expect(flag(args, "-c:a")).toBe("copy");
  });

  it("decodes an open GOP from the previous segment and drops what came before", () => {
    const vaapi: Variant = {
      video: {
        _tag: "Encode",
        codec: "h264",
        encoder: "vaapi",
        rateControl: "cqp",
        bitrateKbps: 2000,
        width: 960,
        height: 540,
        fps: 25,
        deinterlace: "frame",
      },
      audio: aacStereo,
    };
    const args = segmentArgs(
      job({
        variant: vaapi,
        probe: {
          audio: { startPts: 667_440, endPts: 1_208_880 },
          video: { startPts: 666_480, openGop: true },
        },
      }),
    );
    expect(args.indexOf("-vaapi_device")).toBeLessThan(args.indexOf("-i"));
    expect(flag(args, "-filter_complex")).toBe(
      "[1:v:0]trim=start_pts=666480,bwdif=mode=send_frame:deint=all,scale=960:540,format=nv12,hwupload[v];" +
        "[1:a:0]aresample=48000,atrim=start_pts=350208[a]",
    );
    expect(flag(args, "-c:v")).toBe("h264_vaapi");
    expect(flag(args, "-rc_mode")).toBe("CQP");
  });
});

describe("reading a segment's packets", () => {
  const json = JSON.stringify({
    packets: [
      { stream_index: 1, pts: 126_000, duration: 2880, flags: "K__" },
      { stream_index: 0, pts: 129_600, flags: "K__" },
      { stream_index: 0, pts: 122_000, flags: "___" },
      { stream_index: 2, pts: 126_100, duration: 2880, flags: "K__" },
      { stream_index: 1, pts: 128_880, duration: 2880, flags: "K__" },
    ],
    streams: [
      { index: 0, codec_type: "video" },
      { index: 1, codec_type: "audio" },
      { index: 2, codec_type: "audio" },
    ],
  });

  it("finds the converted track's first and last packet and an open GOP", () => {
    expect(parseSegmentProbe(json, 0)).toEqual({
      audio: { startPts: 126_000, endPts: 131_760 },
      video: { startPts: 122_000, openGop: true },
    });
    expect(parseSegmentProbe(json, 1).audio).toEqual({ startPts: 126_100, endPts: 128_980 });
  });

  it("reads nothing from output it cannot parse", () => {
    expect(parseSegmentProbe("not json", 0)).toEqual({});
  });

  it("asks ffprobe for streams and packets as JSON", () => {
    expect(probeArgs("/a.ts")).toContain("json");
  });
});

describe("how many pictures convert at once", () => {
  it("runs as many picture jobs as the setting allows conversions", () => {
    expect(pictureJobSlots("auto", "qsv", 2)).toBe(6);
    expect(pictureJobSlots("auto", "software", 16)).toBe(4);
    expect(pictureJobSlots("2", "nvenc", 16)).toBe(2);
  });

  it("bounds picture jobs generously with no limit", () => {
    expect(pictureJobSlots("unlimited", "vaapi", 2)).toBe(UNLIMITED_HARDWARE_JOBS);
    expect(pictureJobSlots("unlimited", "software", 12)).toBe(12);
  });
});
