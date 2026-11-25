import { describe, expect, it } from "vitest";
import {
  emptyInputSummary,
  feedProgressLine,
  parseLogLine,
  parseStreamLine,
  summarizeInput,
} from "../../src/capture/ffmpeg-output.ts";
import { captureArgs, inputArgs } from "../../src/capture/ffmpeg.ts";

// Real ffmpeg 9 output from `-loglevel level+info` against an HTTP MPEG-TS input.
const STDERR = [
  "[info] Input #0, mpegts, from 'http://127.0.0.1:18731/stream.ts':",
  "[info]   Duration: N/A, start: 1.400000, bitrate: N/A",
  "[info]   Program 1 ",
  "[info]   Stream #0:0[0x100]: Video: h264 (Constrained Baseline) ([27][0][0][0] / 0x001B), yuv420p(progressive), 320x180 [SAR 1:1 DAR 16:9], 25 fps, 25 tbr, 90k tbn, start 1.421333",
  "[info]   Stream #0:1[0x101](deu): Audio: aac (LC) ([15][0][0][0] / 0x000F), 48000 Hz, stereo, fltp, 128 kb/s, start 1.400000",
  "[info] Stream mapping:",
  "[info]   Stream #0:0 -> #0:0 (copy)",
  "[segment @ 0x7c3cc0ef80] [info] Opening 'seg-000001.ts' for writing",
  "[info] Output #0, segment, to 'seg-%06d.ts':",
  "[info]   Stream #0:0: Video: h264 (Constrained Baseline), yuv420p(progressive), 1920x1080, 50 fps",
];

describe("parseLogLine", () => {
  it("splits component, level and message", () => {
    expect(parseLogLine("[segment @ 0x7c3cc0ef80] [info] Opening 'a.ts' for writing")).toEqual({
      component: "segment",
      level: "info",
      message: "Opening 'a.ts' for writing",
    });
    expect(parseLogLine("[http @ 0xabc] [error] HTTP error 403 Forbidden")).toEqual({
      component: "http",
      level: "error",
      message: "HTTP error 403 Forbidden",
    });
    expect(parseLogLine("[fatal] Error opening input files: Connection refused")).toMatchObject({
      component: null,
      level: "fatal",
    });
    expect(parseLogLine("plain text")).toEqual({
      component: null,
      level: "info",
      message: "plain text",
    });
  });
});

describe("summarizeInput", () => {
  it("collects the first input's container, codecs, resolution and audio tracks", () => {
    const summary = STDERR.reduce(
      (acc, line) => summarizeInput(acc, parseLogLine(line).message),
      emptyInputSummary,
    );
    expect(summary.phase).toBe("done");
    expect(summary.info).toEqual({
      container: "mpegts",
      bitrate: null,
      video: [
        {
          index: 0,
          codec: "h264",
          profile: "Constrained Baseline",
          level: null,
          width: 320,
          height: 180,
          fps: 25,
          interlaced: false,
          pixelFormat: "yuv420p",
        },
      ],
      audio: [
        {
          index: 1,
          codec: "aac",
          profile: "LC",
          channels: 2,
          channelLayout: "stereo",
          sampleRate: 48000,
          language: "deu",
          bitrate: 128_000,
        },
      ],
    });
  });
});

describe("parseStreamLine", () => {
  it("detects interlaced SD broadcasts and surround audio", () => {
    expect(
      parseStreamLine(
        "  Stream #0:0[0x1ff]: Video: mpeg2video (Main), yuv420p(tv, top first), 720x576 [SAR 64:45 DAR 16:9], 25 fps, 50 tbr, 90k tbn",
      ),
    ).toMatchObject({
      kind: "video",
      track: { codec: "mpeg2video", interlaced: true, width: 720 },
    });
    expect(
      parseStreamLine("  Stream #0:2[0x201](eng): Audio: ac3, 48000 Hz, 5.1(side), fltp, 448 kb/s"),
    ).toMatchObject({ kind: "audio", track: { codec: "ac3", channels: 6, bitrate: 448_000 } });
  });

  it("ignores other lines", () => {
    expect(parseStreamLine("  Stream #0:3[0x300]: Data: bin_data")).toBeNull();
    expect(parseStreamLine("Stream mapping:")).toBeNull();
  });
});

describe("feedProgressLine", () => {
  it("reports speed and media time when a block ends", () => {
    const pending = new Map<string, string>();
    expect(feedProgressLine(pending, "out_time_us=9021333")).toBeNull();
    expect(feedProgressLine(pending, "speed=2.23x")).toBeNull();
    expect(feedProgressLine(pending, "progress=continue")).toEqual({
      speed: 2.23,
      outTimeMs: 9021,
      ended: false,
    });
    expect(feedProgressLine(pending, "speed=N/A")).toBeNull();
    expect(feedProgressLine(pending, "progress=end")).toEqual({
      speed: null,
      outTimeMs: null,
      ended: true,
    });
  });
});

describe("arguments", () => {
  it("adds network options only for network inputs", () => {
    expect(inputArgs({ url: "/tmp/x.ts" })).toEqual(["-i", "/tmp/x.ts"]);
    expect(
      inputArgs({
        url: "http://tv.local/1.ts",
        userAgent: "Slipstream",
        headers: { Referer: "http://tv.local" },
        ioTimeoutMs: 5000,
      }),
    ).toEqual([
      "-protocol_whitelist",
      "http,https,tcp,tls,crypto,hls",
      "-rw_timeout",
      "5000000",
      "-user_agent",
      "Slipstream",
      "-headers",
      "Referer: http://tv.local\r\n",
      "-i",
      "http://tv.local/1.ts",
    ]);
  });

  it("limits every input that names a protocol to the network ones", () => {
    for (const url of ["file:///srv/x.ts", "concat:/srv/a.ts|/srv/b.ts", "data:,x"]) {
      const args = inputArgs({ url });
      expect(args.slice(0, 2)).toEqual(["-protocol_whitelist", "http,https,tcp,tls,crypto,hls"]);
      expect(args.slice(-2)).toEqual(["-i", url]);
    }
  });

  it("stream-copies into csv-listed MPEG-TS segments", () => {
    const args = captureArgs(
      { url: "http://tv.local/1.ts" },
      { segmentSeconds: 6, listFile: "r0001.csv", segmentPattern: "r0001-%06d.ts" },
    );
    expect(args.join(" ")).toContain(
      "-c copy -f segment -segment_format mpegts -segment_time 6 -segment_list r0001.csv -segment_list_type csv",
    );
    expect(args.at(-1)).toBe("r0001-%06d.ts");
  });
});
