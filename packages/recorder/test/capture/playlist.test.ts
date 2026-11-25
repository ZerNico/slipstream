import { describe, expect, it } from "vitest";
import type { Segment } from "../../src/capture/model.ts";
import {
  discontinuities,
  livePlaylist,
  recordingPlaylist,
  segmentsInRange,
} from "../../src/capture/playlist.ts";

const T0 = Date.UTC(2026, 10, 21, 20, 0, 0);

/** Builds contiguous 6 s segments per run, with `gapMs` of silence before each later run. */
const capture = (runs: ReadonlyArray<{ count: number; gapMs?: number }>): Array<Segment> => {
  const segments: Array<Segment> = [];
  let at = T0;
  runs.forEach((run, r) => {
    at += run.gapMs ?? 0;
    for (let i = 0; i < run.count; i++) {
      segments.push({
        captureId: "c1",
        runId: `c1-r${r + 1}`,
        sequence: segments.length,
        startMs: at,
        durationMs: 6000,
        bytes: 1000,
        path: `r${r + 1}-${i}.ts`,
      });
      at += 6000;
    }
  });
  return segments;
};

const tagLines = (playlist: string, tag: string) =>
  playlist.split("\n").filter((line) => line.startsWith(tag));

describe("discontinuities", () => {
  it("marks run boundaries and wall-clock holes, never the first segment", () => {
    const segments = capture([{ count: 2 }, { count: 2, gapMs: 30_000 }]);
    expect(discontinuities(segments)).toEqual([false, false, true, false]);
  });

  it("marks a hole inside one run", () => {
    const segments = capture([{ count: 3 }]).map((segment, i) =>
      i === 2 ? { ...segment, startMs: segment.startMs + 5000 } : segment,
    );
    expect(discontinuities(segments)).toEqual([false, false, true]);
  });

  it("tolerates jitter below the tolerance", () => {
    const segments = capture([{ count: 2 }]).map((segment, i) =>
      i === 1 ? { ...segment, startMs: segment.startMs + 400 } : segment,
    );
    expect(discontinuities(segments)).toEqual([false, false]);
    expect(discontinuities(segments, 100)).toEqual([false, true]);
  });
});

describe("livePlaylist", () => {
  it("keeps only the DVR window, with stable media and discontinuity sequences", () => {
    const segments = capture([{ count: 5 }, { count: 10, gapMs: 12_000 }]);
    const playlist = livePlaylist(segments, { dvrWindowMs: 30_000 });
    const uris = playlist.split("\n").filter((line) => line.endsWith(".ts"));
    // 30 s back from the live edge is the last five segments, all in run 2.
    expect(uris).toEqual(["r2-5.ts", "r2-6.ts", "r2-7.ts", "r2-8.ts", "r2-9.ts"]);
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:10\n");
    expect(playlist).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:1\n");
    expect(tagLines(playlist, "#EXT-X-DISCONTINUITY\n")).toHaveLength(0);
    expect(playlist).not.toContain("#EXT-X-PLAYLIST-TYPE");
    expect(playlist).not.toContain("#EXT-X-ENDLIST");
  });

  it("places the discontinuity tag inside the window and counts none before it", () => {
    const segments = capture([{ count: 5 }, { count: 2, gapMs: 12_000 }]);
    const playlist = livePlaylist(segments, { dvrWindowMs: 60_000 });
    const lines = playlist.split("\n");
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:0\n");
    expect(playlist).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:0\n");
    const tag = lines.indexOf("#EXT-X-DISCONTINUITY");
    expect(tag).toBeGreaterThan(0);
    // The tag sits right before the first segment of run 2.
    expect(lines.slice(tag, tag + 4)).toEqual([
      "#EXT-X-DISCONTINUITY",
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(T0 + 5 * 6000 + 12_000).toISOString()}`,
      "#EXTINF:6.000,",
      "r2-0.ts",
    ]);
  });

  it("drops a discontinuity tag that would land on the first segment of the window", () => {
    const segments = capture([{ count: 5 }, { count: 3, gapMs: 12_000 }]);
    const playlist = livePlaylist(segments, { dvrWindowMs: 18_000 });
    expect(playlist.split("\n").find((line) => line.endsWith(".ts"))).toBe("r2-0.ts");
    expect(playlist).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:1\n");
    expect(playlist).not.toContain("#EXT-X-DISCONTINUITY\n");
  });

  it("keeps a minimum number of segments for a tiny window", () => {
    const playlist = livePlaylist(capture([{ count: 10 }]), { dvrWindowMs: 1000 });
    expect(tagLines(playlist, "#EXTINF")).toHaveLength(3);
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:7\n");
  });

  it("is a valid empty playlist before the first segment", () => {
    const playlist = livePlaylist([], { dvrWindowMs: 60_000 });
    expect(playlist).toBe(
      "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-DISCONTINUITY-SEQUENCE:0\n",
    );
  });

  it("uses the URI builder and rounds the target duration up", () => {
    const segments = capture([{ count: 2 }]).map((segment) => ({ ...segment, durationMs: 6400 }));
    const playlist = livePlaylist(segments, {
      dvrWindowMs: 60_000,
      segmentUri: (segment) => `/hls/c1/${segment.sequence}.ts`,
    });
    expect(playlist).toContain("#EXT-X-TARGETDURATION:7\n");
    expect(playlist).toContain("#EXTINF:6.400,\n/hls/c1/0.ts\n");
  });
});

describe("recordingPlaylist", () => {
  const segments = capture([{ count: 10 }, { count: 10, gapMs: 42_000 }]);

  it("is an EVENT playlist from the range start while the recording runs", () => {
    const from = T0 + 20_000;
    const playlist = recordingPlaylist(segments, {
      fromMs: from,
      toMs: T0 + 3_600_000,
      complete: false,
    });
    expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:EVENT\n");
    expect(playlist).toContain("#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n");
    expect(playlist).not.toContain("#EXT-X-ENDLIST");
    // The segment covering 20 s (18 to 24 s) is the first one, sequence 3.
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:3\n");
    expect(playlist).not.toContain("#EXT-X-DISCONTINUITY-SEQUENCE");
    expect(tagLines(playlist, "#EXTINF")).toHaveLength(17);
    expect(tagLines(playlist, "#EXT-X-DISCONTINUITY")).toEqual(["#EXT-X-DISCONTINUITY"]);
    expect(tagLines(playlist, "#EXT-X-PROGRAM-DATE-TIME")[0]).toBe(
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(T0 + 18_000).toISOString()}`,
    );
  });

  it("grows as segments arrive and turns VOD with ENDLIST when complete", () => {
    const range = { fromMs: T0, toMs: T0 + 60_000 };
    const growing = recordingPlaylist(segments.slice(0, 4), { ...range, complete: false });
    expect(tagLines(growing, "#EXTINF")).toHaveLength(4);
    const done = recordingPlaylist(segments, { ...range, complete: true });
    expect(tagLines(done, "#EXTINF")).toHaveLength(10);
    expect(done).toContain("#EXT-X-PLAYLIST-TYPE:VOD\n");
    expect(done.endsWith("#EXT-X-ENDLIST\n")).toBe(true);
    expect(done).not.toContain("#EXT-X-DISCONTINUITY");
  });

  it("can start players at the live edge instead", () => {
    const playlist = recordingPlaylist(segments, {
      fromMs: T0,
      toMs: T0 + 60_000,
      complete: false,
      startAtBeginning: false,
    });
    expect(playlist).not.toContain("#EXT-X-START");
  });
});

describe("segmentsInRange", () => {
  it("includes segments that overlap the edges and excludes ones that only touch", () => {
    const segments = capture([{ count: 5 }]);
    const picked = segmentsInRange(segments, T0 + 6000, T0 + 13_000);
    expect(picked.map((segment) => segment.sequence)).toEqual([1, 2]);
  });
});
