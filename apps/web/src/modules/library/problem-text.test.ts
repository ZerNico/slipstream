import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import { type RecordingProblem, recordingGapSummary } from "@slipstream/domain";
import { makeMockData } from "~/api/mock/fixtures.ts";
import type { Entry } from "./library.ts";
import { entryProblem, entryProblemText } from "./problem-text.ts";

const NOW = Date.UTC(2026, 10, 22, 5, 12);
const data = makeMockData(NOW);
const base = data.recordings.find((entry) => entry.id === "presse-qualifying");
if (base === undefined) throw new Error("no fixture recording");

const start = DateTime.toEpochMillis(base.start) - base.padding.beforeMinutes * 60_000;
const end = DateTime.toEpochMillis(base.end) + base.padding.afterMinutes * 60_000;
const minute = (offset: number) => DateTime.makeUnsafe(start + offset * 60_000);
const gap = (from: number, to: number): RecordingProblem => ({
  _tag: "Gap",
  range: { start: minute(from), end: minute(to) },
});
const incomplete = (problems: readonly RecordingProblem[]): Entry => ({
  ...base,
  state: "incomplete",
  problems: [...problems],
});

describe("entryProblem", () => {
  it("writes one line per merged gap, in time order, and the missing total", () => {
    const copy = entryProblem(
      incomplete([gap(30, 32), gap(10, 12), gap(11, 13), gap(10, 12), gap(32, 33)]),
    );
    expect(copy.failed).toBe(false);
    expect(copy.lines).toHaveLength(2);
    expect(copy.lines[0]).toMatch(/^Missing 3\smin/u);
    expect(copy.lines[1]).toMatch(/^Missing 3\smin/u);
    expect(copy.total).toMatch(/^2 gaps, 6\smin missing in total\.$/u);
    expect(entryProblemText(incomplete([gap(30, 32), gap(10, 12)]))).toMatch(
      /^2 gaps, 4\smin missing in total\.$/u,
    );
  });

  it("names the cause the reports give for a stretch, and says nothing about a total for one", () => {
    const copy = entryProblem(
      incomplete([
        gap(10, 12),
        {
          _tag: "SourceUnreachable",
          range: { start: minute(11), end: minute(14) },
          retries: 3,
        },
      ]),
    );
    expect(copy.lines).toHaveLength(1);
    expect(copy.lines[0]).toMatch(/^The source was unreachable .*retried 3 times\.$/u);
    expect(copy.total).toBeUndefined();
  });

  it("counts a busy-source stretch and a gap once each, the totals Home quotes", () => {
    const entry = incomplete([
      { _tag: "SourceLimitReached", range: { start: minute(10), end: minute(14) } },
      gap(12, 15),
      gap(40, 42),
    ]);
    const copy = entryProblem(entry);
    expect(copy.lines).toHaveLength(2);
    // The busy source is the more telling cause of the merged 10–15 stretch.
    expect(copy.lines[0]).toMatch(/^Every stream the source allows was busy/u);
    expect(copy.lines[1]).toMatch(/^Missing 2\smin/u);
    // 10–15 and 40–42: 7 min in two places, the same summary Home reads.
    expect(recordingGapSummary(entry).missingMs).toBe(7 * 60_000);
    expect(copy.total).toMatch(/^2 gaps, 7\smin missing in total\.$/u);
  });

  it("clips gaps to the window it records", () => {
    const copy = entryProblem(incomplete([gap(-30, 2)]));
    expect(copy.lines[0]).toMatch(/^Missing 2\smin/u);
  });

  it("reads as failed when the gaps cover the whole window, whatever the state says", () => {
    const minutes = (end - start) / 60_000;
    const copy = entryProblem(incomplete([gap(0, minutes / 2), gap(minutes / 2 - 1, minutes)]));
    expect(copy).toEqual({
      failed: true,
      lines: ["The source sent no picture for the whole slot."],
      total: undefined,
      missingMs: end - start,
    });
  });

  it("reads a failed recording as failed", () => {
    const failed = data.recordings.find((entry) => entry.id === "tagesschau-failed");
    if (failed === undefined) throw new Error("no fixture recording");
    expect(entryProblem(failed).failed).toBe(true);
  });
});
