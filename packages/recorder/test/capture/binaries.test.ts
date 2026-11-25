import { describe, expect, it } from "vitest";
import { majorOf, parseVersion, siblingFfprobe } from "../../src/capture/binaries.ts";

describe("parseVersion", () => {
  it("reads release, distribution and short versions, not git snapshots", () => {
    expect(parseVersion("ffmpeg version 9.0.2 Copyright (c) 2000-2026")).toBe("9.0.2");
    expect(parseVersion("ffprobe version n7.1-25-g1234 Copyright")).toBe("7.1");
    expect(parseVersion("ffprobe version 8.1 Copyright")).toBe("8.1");
    expect(parseVersion("ffmpeg version 8.1.3-Jellyfin Copyright (c) 2000-2026")).toBe("8.1.3");
    expect(parseVersion("ffmpeg version N-118000-gabcdef")).toBeNull();
    expect(parseVersion("nonsense")).toBeNull();
    expect(majorOf("9.0.2")).toBe(9);
  });
});

describe("siblingFfprobe", () => {
  it("finds ffprobe next to a configured ffmpeg", () => {
    expect(siblingFfprobe("/opt/ffmpeg/bin/ffmpeg")).toBe("/opt/ffmpeg/bin/ffprobe");
    expect(siblingFfprobe("C:\\ffmpeg\\ffmpeg.exe")).toBe("C:\\ffmpeg\\ffprobe.exe");
    expect(siblingFfprobe("ffmpeg")).toBe("ffprobe");
    expect(siblingFfprobe("/usr/bin/avconv")).toBe("ffprobe");
  });
});
