import { describe, expect, it } from "vitest";
import {
  indexEntry,
  initialIndexState,
  parseListLine,
  startRun,
  type IndexState,
  type ListEntry,
} from "../../src/capture/segment-index.ts";

const T0 = Date.UTC(2026, 10, 21, 20, 0, 0);

const feed = (state: IndexState, entries: ReadonlyArray<[ListEntry, number]>) => {
  const out = [];
  let current = state;
  for (const [entry, observedAt] of entries) {
    const result = indexEntry(current, entry, observedAt, 100, entry.file);
    out.push(result);
    current = result.state;
  }
  return { state: current, out };
};

describe("parseListLine", () => {
  it("parses ffmpeg csv lines, quoted or not", () => {
    expect(parseListLine("r0001-000000.ts,0.000000,2.021333")).toEqual({
      file: "r0001-000000.ts",
      startSec: 0,
      endSec: 2.021333,
    });
    expect(parseListLine('"a,""b"".ts",2.5,4.5')).toEqual({
      file: 'a,"b".ts',
      startSec: 2.5,
      endSec: 4.5,
    });
  });

  it("rejects partial and malformed lines", () => {
    expect(parseListLine("")).toBeNull();
    expect(parseListLine("r0001-000000.ts,0.0")).toBeNull();
    expect(parseListLine("x.ts,abc,1")).toBeNull();
    expect(parseListLine("x.ts,3,1")).toBeNull();
  });
});

describe("indexEntry", () => {
  it("anchors a run once and places later segments by media time", () => {
    const state = startRun(initialIndexState("c1", ""), "c1-r0001");
    const { out } = feed(state, [
      [{ file: "a.ts", startSec: 0, endSec: 6 }, T0 + 6000],
      // Observed late (slow poll): placement still follows media time, not observation time.
      [{ file: "b.ts", startSec: 6, endSec: 12.04 }, T0 + 14_000],
      [{ file: "c.ts", startSec: 12.04, endSec: 18 }, T0 + 18_100],
    ]);
    expect(out.map((r) => [r.segment.sequence, r.segment.startMs, r.segment.durationMs])).toEqual([
      [0, T0, 6000],
      [1, T0 + 6000, 6040],
      [2, T0 + 12_040, 5960],
    ]);
    expect(out[0]?.segment).toMatchObject({ captureId: "c1", runId: "c1-r0001", bytes: 100 });
  });

  it("leaves the hole between runs and keeps the sequence going", () => {
    const first = feed(startRun(initialIndexState("c1", ""), "r1"), [
      [{ file: "a.ts", startSec: 0, endSec: 6 }, T0 + 6000],
      [{ file: "b.ts", startSec: 6, endSec: 12 }, T0 + 12_000],
    ]);
    // ffmpeg restarts media time at zero; the new run comes back 20 s after run 1 ended.
    const second = feed(startRun(first.state, "r2"), [
      [{ file: "c.ts", startSec: 0, endSec: 6 }, T0 + 38_000],
    ]);
    const result = second.out[0];
    expect(result?.segment).toMatchObject({ sequence: 2, runId: "r2", startMs: T0 + 32_000 });
  });

  it("never overlaps the previous run when an upstream replays buffered media", () => {
    const first = feed(startRun(initialIndexState("c1", ""), "r1"), [
      [{ file: "a.ts", startSec: 0, endSec: 6 }, T0 + 6000],
    ]);
    // A burst at reconnect: 18 s of media arrive within 2 s of run 1 ending.
    const second = feed(startRun(first.state, "r2"), [
      [{ file: "b.ts", startSec: 0, endSec: 6 }, T0 + 7000],
      [{ file: "c.ts", startSec: 6, endSec: 12 }, T0 + 7500],
      [{ file: "d.ts", startSec: 12, endSec: 18 }, T0 + 8000],
    ]);
    expect(second.out.map((r) => r.segment.startMs)).toEqual([T0 + 6000, T0 + 12_000, T0 + 18_000]);
  });

  it("re-anchors on a media time jump inside a run, leaving the hole", () => {
    const { out } = feed(startRun(initialIndexState("c1", ""), "r1"), [
      [{ file: "a.ts", startSec: 0, endSec: 6 }, T0 + 6000],
      // Upstream timestamps jumped by an hour while only ~10 s of wall-clock time passed.
      [{ file: "b.ts", startSec: 3600, endSec: 3606 }, T0 + 22_000],
    ]);
    expect(out[1]?.segment.startMs).toBe(T0 + 16_000);
  });
});
