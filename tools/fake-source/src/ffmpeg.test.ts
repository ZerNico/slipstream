import { describe, expect, it } from "vitest";
import { findChannel, type FakeChannel } from "./channels.ts";
import { ffmpegArgs } from "./ffmpeg.ts";

const channel = (id: string): FakeChannel => {
  const found = findChannel(id);
  if (!found) throw new Error(`no channel ${id}`);
  return found;
};

/** The value following a flag. */
const flag = (args: ReadonlyArray<string>, name: string) => args[args.indexOf(name) + 1];

describe("ffmpegArgs", () => {
  it("encodes the F1 channel as 1080p50 H.264 with AAC into MPEG-TS on stdout", () => {
    const args = ffmpegArgs(channel("sportkanal-f1"), null);
    expect(args).toContain("testsrc2=size=1920x1080:rate=50");
    expect(flag(args, "-c:v")).toBe("libx264");
    expect(flag(args, "-c:a")).toBe("aac");
    expect(flag(args, "-g")).toBe("100");
    expect(args.slice(-3)).toEqual(["-f", "mpegts", "pipe:1"]);
    expect(args.filter((arg) => arg === "-re")).toHaveLength(2);
    expect(flag(args, "-filter_complex")).toBe(
      "[0:v]format=yuv420p[v];[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a]",
    );
  });

  it("generates 576i at the field rate and weaves top field first", () => {
    const args = ffmpegArgs(channel("doku-plus"), null);
    expect(args).toContain("smptehdbars=size=720x576:rate=50");
    expect(flag(args, "-filter_complex")).toContain(
      "interlace=scan=tff:lowpass=complex,setfield=tff",
    );
    expect(flag(args, "-flags")).toBe("+ildct+ilme");
    expect(flag(args, "-x264-params")).toBe("tff=1");
  });

  it("uses MP2 audio on the regional channel", () => {
    const args = ffmpegArgs(channel("regional"), null);
    expect(flag(args, "-c:a")).toBe("mp2");
    expect(flag(args, "-b:a")).toBe("192k");
  });

  it("uses AC-3 stereo at 192 kbit/s on the Filmhaus channel, as private HD channels send it", () => {
    const args = ffmpegArgs(channel("filmhaus"), null);
    expect(flag(args, "-c:a")).toBe("ac3");
    expect(flag(args, "-b:a")).toBe("192k");
  });

  it("burns in clock, channel and programme with escaped drawtext options", () => {
    const args = ffmpegArgs(channel("serienwelt"), {
      channelFile: "/tmp/a:b/channel.txt",
      programmeFile: "/tmp/x/programme.txt",
      fontFile: "/fonts/Arial.ttf",
    });
    const graph = flag(args, "-filter_complex") ?? "";
    expect(graph.match(/drawtext=/g)).toHaveLength(3);
    // The colon inside the clock expansion is escaped once for the option, once for the graph.
    expect(graph).toContain(String.raw`text=%{localtime\\:%d.%m.%Y %T}`);
    expect(graph).toContain(String.raw`textfile=/tmp/a\\:b/channel.txt`);
    expect(graph).toContain("textfile=/tmp/x/programme.txt:reload=25:expansion=none");
    expect(graph).toContain("fontfile=/fonts/Arial.ttf");
  });
});
