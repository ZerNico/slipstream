import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, onTestFinished } from "vitest";
import { ffmpegBinaries, quickChecks, requiredNodeMajor } from "./doctor.ts";
import { prefixLines } from "./processes.ts";

/** A fake `ffmpeg` (and `ffprobe` beside it) printing this version and filter list. */
const fakeFfmpeg = (version: string, filters = " ... drawtext V->V"): string => {
  const dir = mkdtempSync(join(tmpdir(), "slipstream-doctor-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const ffmpeg = join(dir, "ffmpeg");
  writeFileSync(
    ffmpeg,
    `#!/bin/sh\nif [ "$1" = "-version" ]; then echo "ffmpeg version ${version} Copyright"; else echo "${filters}"; fi\n`,
  );
  writeFileSync(join(dir, "ffprobe"), `#!/bin/sh\necho "ffprobe version ${version}"\n`);
  chmodSync(ffmpeg, 0o755);
  chmodSync(join(dir, "ffprobe"), 0o755);
  return ffmpeg;
};

/** Runs the quick checks with `SLIPSTREAM_FFMPEG` pointing at `path`. */
const checksWith = (path: string) => {
  const before = process.env["SLIPSTREAM_FFMPEG"];
  process.env["SLIPSTREAM_FFMPEG"] = path;
  try {
    const results = quickChecks();
    return (name: string) => results.find((check) => check.name === name);
  } finally {
    if (before === undefined) delete process.env["SLIPSTREAM_FFMPEG"];
    else process.env["SLIPSTREAM_FFMPEG"] = before;
  }
};

describe("ffmpegBinaries", () => {
  it("finds ffprobe next to a configured ffmpeg", () => {
    expect(ffmpegBinaries({ SLIPSTREAM_FFMPEG: "/opt/ff/bin/ffmpeg" })).toEqual({
      ffmpeg: "/opt/ff/bin/ffmpeg",
      ffprobe: "/opt/ff/bin/ffprobe",
    });
    expect(ffmpegBinaries({})).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
  });
});

describe("quickChecks", () => {
  it("passes this Node, which .node-version pins", () => {
    expect(Number.parseInt(process.versions.node, 10)).toBe(requiredNodeMajor());
    expect(quickChecks().find((check) => check.name === "Node")?.status).toBe("ok");
  });

  it("fails ffmpeg 7 with a fix", () => {
    const ffmpeg = checksWith(fakeFfmpeg("7.1"))("ffmpeg");
    expect(ffmpeg).toMatchObject({ status: "fail", detail: "7.1, Slipstream needs 8 or newer" });
    expect(ffmpeg?.fix).toBeDefined();
  });

  it("accepts ffmpeg 9 with drawtext", () => {
    const check = checksWith(fakeFfmpeg("9.0.2"));
    expect(check("ffmpeg")?.status).toBe("ok");
    expect(check("ffprobe")?.status).toBe("ok");
    expect(check("ffmpeg drawtext")?.status).toBe("ok");
  });

  it("only warns when drawtext is missing, and says why", () => {
    const drawtext = checksWith(fakeFfmpeg("9.0.2", " ... scale V->V"))("ffmpeg drawtext");
    expect(drawtext?.status).toBe("warn");
    expect(drawtext?.why).toMatch(/fake source still works/u);
  });

  it("fails a missing ffmpeg", () => {
    expect(checksWith("/nonexistent/ffmpeg")("ffmpeg")).toMatchObject({
      status: "fail",
      detail: "/nonexistent/ffmpeg not found",
    });
  });
});

describe("prefixLines", () => {
  it("prefixes every line, including a last one without a newline", async () => {
    const stream = new PassThrough();
    const lines: Array<string> = [];
    prefixLines(stream, "[server]", (line) => lines.push(line));
    stream.end("listening\r\nready\nlast");
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines).toEqual(["[server] listening", "[server] ready", "[server] last"]);
  });
});
