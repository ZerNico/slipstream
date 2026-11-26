import { focusedCell, initialCursor, defaultGuideConfig } from "../tv/guide/core/index.ts";
import { describe, expect, it } from "vitest";
import { channel, conflict, programme, recording } from "../../tests/fixtures.ts";
import { buildGuide, cellLabel, guideReady } from "./guide-data.ts";
import { GuideRepeat, HOUR } from "@slipstream/domain";
import { Schema } from "effect";

const T = Date.UTC(2026, 10, 22, 5);

const channels = [
  channel("arte", "arte", 8),
  channel("f1", "Sky Sport F1", 106),
  channel("news", "Sky Sport News"),
  channel("hidden", "Shopping", 50, true),
  channel("ard", "Das Erste", 1),
];

const programmes = [
  programme("race", "f1", T, T + 2 * HOUR, "Live F1: Rennen"),
  programme("analysis", "f1", T + 2 * HOUR, T + 3 * HOUR, "Live F1: Analyse"),
  programme("compact", "f1", T + 3 * HOUR, T + 4 * HOUR, "F1: Rennen Kompakt"),
  programme("pate", "arte", T, T + 3 * HOUR, "Der Pate"),
  programme("shop", "hidden", T, T + HOUR),
  programme("tagesschau", "ard", T, T + HOUR),
];

const noMarks = { recordings: [], conflicts: [], repeats: [] };

/** An airing the viewer already has, as `GET /guide/repeats` sends it. */
const repeat = (programmeId: string, state: string, ruleId?: string) =>
  Schema.decodeUnknownSync(GuideRepeat)({
    programmeId,
    ...(ruleId === undefined ? {} : { ruleId }),
    of: { start: new Date(T - 24 * HOUR).toISOString(), channelId: "one", state },
  });

describe("buildGuide", () => {
  it("orders visible channels by number, unnumbered last, and skips hidden ones", () => {
    const { guide, info } = buildGuide(channels, programmes, noMarks);
    expect(guide.channels.map((row) => row.id)).toEqual(["ard", "arte", "f1", "news"]);
    expect(guide.channels.map((row) => row.number)).toEqual([1, 8, 106, -1]);
    expect(info.get("f1")).toEqual({ name: "Sky Sport F1", mark: "F1" });
    expect(info.has("hidden")).toBe(false);
  });

  it("converts programme times to epoch ms and keeps the data range", () => {
    const { guide } = buildGuide(channels, programmes, noMarks);
    const f1 = guide.channels.find((row) => row.id === "f1");
    expect(f1?.programmes.map((cell) => [cell.start, cell.end])).toEqual([
      [T, T + 2 * HOUR],
      [T + 2 * HOUR, T + 3 * HOUR],
      [T + 3 * HOUR, T + 4 * HOUR],
    ]);
    expect(guide.start).toBe(T);
    expect(guide.end).toBe(T + 4 * HOUR);
  });

  it("marks programmes from running, scheduled and conflicting recordings", () => {
    const { guide } = buildGuide(channels, programmes, {
      recordings: [
        recording({
          id: "r1",
          channelId: "f1",
          programmeId: "race",
          start: T,
          end: T + 2 * HOUR,
          state: "recording",
        }),
        recording({
          id: "r2",
          channelId: "f1",
          programmeId: "compact",
          start: T + 3 * HOUR,
          end: T + 4 * HOUR,
        }),
        recording({
          id: "r3",
          channelId: "arte",
          programmeId: "pate",
          start: T,
          end: T + 3 * HOUR,
        }),
        recording({
          id: "r4",
          channelId: "ard",
          programmeId: "tagesschau",
          start: T,
          end: T + HOUR,
          state: "completed",
        }),
      ],
      conflicts: [conflict(["r3"], T, T + HOUR)],
      repeats: [],
    });
    const marks = Object.fromEntries(
      guide.channels.flatMap((row) => row.programmes.map((cell) => [cell.id, cell.mark])),
    );
    expect(marks).toEqual({
      tagesschau: undefined,
      pate: "conflict",
      race: "recording",
      analysis: undefined,
      compact: "scheduled",
    });
  });

  it("matches a manual recording to the programmes inside its range", () => {
    const { guide } = buildGuide(channels, programmes, {
      recordings: [recording({ id: "m", channelId: "f1", start: T + 2 * HOUR, end: T + 4 * HOUR })],
      conflicts: [],
      repeats: [],
    });
    const f1 = guide.channels.find((row) => row.id === "f1");
    expect(f1?.programmes.map((cell) => cell.mark)).toEqual([undefined, "scheduled", "scheduled"]);
  });

  it("gives airings the viewer already has the quiet repeat mark, unless a recording marks them", () => {
    const { guide } = buildGuide(channels, programmes, {
      recordings: [
        recording({ id: "r1", channelId: "f1", programmeId: "race", start: T, end: T + 2 * HOUR }),
      ],
      conflicts: [],
      repeats: [
        repeat("pate", "completed"),
        repeat("analysis", "scheduled", "rule-f1"),
        // Scheduled itself: the ring wins over the check.
        repeat("race", "completed"),
        repeat("tagesschau", "history"),
      ],
    });
    const cells = new Map(
      guide.channels.flatMap((row) => row.programmes.map((cell) => [cell.id, cell])),
    );
    // The domain's repeatKind: a deleted copy is "deleted", labelled like a recorded one.
    expect(cells.get("tagesschau")?.already).toBe("deleted");
    expect(cellLabel({ title: "Tagesschau", already: "deleted" })).toBe(
      "Tagesschau, already recorded",
    );
    expect(cells.get("pate")?.mark).toBe("repeat");
    expect(cells.get("pate")?.already).toBe("recorded");
    expect(cells.get("analysis")?.mark).toBe("repeat");
    expect(cells.get("analysis")?.already).toBe("scheduled");
    expect(cells.get("race")?.mark).toBe("scheduled");
    expect(cells.get("race")?.already).toBeUndefined();
    expect(cells.get("compact")?.mark).toBeUndefined();
  });

  it("says already recorded or already scheduled in the cell's label", () => {
    expect(cellLabel({ title: "Tatort", already: "recorded" })).toBe("Tatort, already recorded");
    expect(cellLabel({ title: "Tatort", already: "scheduled" })).toBe("Tatort, already scheduled");
    expect(cellLabel({ title: "Tatort", already: undefined })).toBe("Tatort");
  });

  it("keeps the guide entry for the record sheet", () => {
    const { guide } = buildGuide(channels, programmes, noMarks);
    const ard = guide.channels.find((row) => row.id === "ard");
    expect(ard?.programmes[0]?.source).toBe(programmes[5]);
  });

  it("gives the cursor something to land on", () => {
    const { guide } = buildGuide(channels, programmes, noMarks);
    const cursor = initialCursor(guide, defaultGuideConfig, T + 30 * 60_000, 2);
    expect(focusedCell(guide, cursor)?.programme?.title).toBe("Live F1: Rennen");
  });
});

describe("guideReady", () => {
  const base = {
    marksPending: false,
    loaded: new Set<string>(),
    focus: "2026-11-22",
    failed: false,
    settled: false,
  };

  it("waits for the day in view, not whichever day answers first", () => {
    expect(guideReady({ ...base, loaded: new Set(["2026-11-21"]) })).toBe(false);
    expect(guideReady({ ...base, loaded: new Set(["2026-11-21", "2026-11-22"]) })).toBe(true);
  });

  it("waits for the channels and the marks", () => {
    expect(guideReady({ ...base, loaded: new Set(["2026-11-22"]), marksPending: true })).toBe(
      false,
    );
  });

  it("stays ready once it was, while a day the cursor moves to loads", () => {
    expect(guideReady({ ...base, focus: "2026-11-25", settled: true })).toBe(true);
  });

  it("gives way to the error when a day fails", () => {
    expect(guideReady({ ...base, failed: true })).toBe(true);
  });
});
