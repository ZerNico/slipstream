import { describe, expect, it } from "vitest";
import {
  emptySpan,
  focusedCell,
  initialCursor,
  isAtNow,
  relocate,
  rowForChannelNumber,
  step,
  type GuideAction,
  type GuideCursor,
} from "./cursor.ts";
import { at, channel, hourly, sampleGuide } from "./fixtures.ts";
import {
  defaultGuideConfig,
  makeGuide,
  programmeIndexAt,
  type Guide,
  type GuideConfig,
} from "./guide.ts";
import { DAY } from "@slipstream/domain";

const config = defaultGuideConfig;
const guide = sampleGuide();
const NOW = at("06:12");

const start = (row = 0): GuideCursor => initialCursor(guide, config, NOW, row);

/** Applies actions in order. */
const run = (cursor: GuideCursor, ...actions: GuideAction[]): GuideCursor =>
  actions.reduce((current, action) => step(guide, config, current, action), cursor);

const focusedId = (cursor: GuideCursor, on: Guide = guide): string | undefined =>
  focusedCell(on, cursor)?.programme?.id;

describe("initialCursor", () => {
  it("starts on the airing programme with half an hour of the past in view", () => {
    expect(start()).toEqual({
      row: 0,
      programme: 0,
      anchor: NOW,
      viewStart: at("05:30"),
      topRow: 0,
    });
  });

  it("prefers the nearest row airing something when it starts on one without data", () => {
    // Row 2 has no data and row 3 is in a gap at 06:12, so row 1 is nearest.
    expect(start(2)).toMatchObject({ row: 1, programme: 0 });
  });

  it("puts the cursor on an empty channel only when nothing else exists", () => {
    const empty = makeGuide([channel("empty", 1, [])]);
    expect(initialCursor(empty, config, NOW)).toMatchObject({ row: 0, programme: -1, anchor: NOW });
  });
});

describe("up and down", () => {
  it("keeps the time anchor and focuses what airs then", () => {
    const down = run(start(), { _tag: "Down" });
    expect(down).toMatchObject({ row: 1, anchor: NOW });
    expect(focusedId(down)).toBe("zdf@05:45");
  });

  it("stops on a channel without data, on its empty space, keeping the anchor", () => {
    const cursor = run(start(), { _tag: "Down" }, { _tag: "Down" });
    expect(cursor).toMatchObject({ row: 2, programme: -1, anchor: NOW, viewStart: at("05:30") });
    expect(focusedCell(guide, cursor)).toMatchObject({ channel: { id: "empty" } });
    expect(focusedId(cursor)).toBeUndefined();
  });

  it("stops on a channel in a gap at the anchor, then carries on at the same time", () => {
    const gap = run(start(), { _tag: "Down", steps: 3 });
    expect(gap).toMatchObject({ row: 3, programme: -1, anchor: NOW });
    const below = run(gap, { _tag: "Down" });
    expect(below).toMatchObject({ row: 4, anchor: NOW });
    expect(focusedId(below)).toBe("e1@05:30");
    expect(run(below, { _tag: "Up" }, { _tag: "Up" }, { _tag: "Up" }).row).toBe(1);
  });

  it("focuses a gap channel's programme once the anchor is outside the gap", () => {
    const later = run(start(1), { _tag: "Right" }, { _tag: "Right" });
    expect(later.anchor).toBe(at("07:00"));
    const empty = run(later, { _tag: "Down" });
    expect(empty).toMatchObject({ row: 2, programme: -1, anchor: at("07:00") });
    const down = run(empty, { _tag: "Down" });
    expect(down.row).toBe(3);
    expect(focusedId(down)).toBe("gap@07:00");
  });

  it("reaches every channel one row at a time", () => {
    const rows: number[] = [];
    let cursor = start();
    for (;;) {
      rows.push(cursor.row);
      const next = step(guide, config, cursor, { _tag: "Down" });
      if (next === cursor) break;
      cursor = next;
    }
    expect(rows).toEqual(Array.from({ length: guide.channels.length }, (_, row) => row));
  });

  it("returns to the same short programme after crossing longer ones", () => {
    const news = run(start(), { _tag: "Right" });
    expect(focusedId(news)).toBe("ard@06:20");
    const back = run(news, { _tag: "Down" }, { _tag: "Down" }, { _tag: "Up" }, { _tag: "Up" });
    expect(focusedId(back)).toBe("ard@06:20");
    expect(back.anchor).toBe(at("06:20"));
  });

  it("returns the same object at the top and bottom edges", () => {
    const top = start();
    expect(step(guide, config, top, { _tag: "Up" })).toBe(top);
    const bottom = run(top, { _tag: "Channel", number: 219 });
    expect(bottom.row).toBe(24);
    expect(step(guide, config, bottom, { _tag: "Down" })).toBe(bottom);
  });

  it("moves onto a last row without data, then stops there", () => {
    const lonely = makeGuide([channel("a", 1, [["06:00", "07:00"]]), channel("b", 2, [])]);
    const cursor = step(lonely, config, initialCursor(lonely, config, NOW), { _tag: "Down" });
    expect(cursor).toMatchObject({ row: 1, programme: -1, anchor: NOW });
    expect(step(lonely, config, cursor, { _tag: "Down" })).toBe(cursor);
  });

  it("moves several rows at once for held keys", () => {
    expect(run(start(), { _tag: "Down", steps: 3 }).row).toBe(3);
    expect(run(start(), { _tag: "Down", steps: 99 }).row).toBe(24);
  });

  it("scrolls rows only when the cursor leaves the viewport", () => {
    const fifth = run(start(), { _tag: "Channel", number: 202 });
    expect(fifth).toMatchObject({ row: 7, topRow: 1 });
    const up = run(fifth, { _tag: "Up" });
    expect(up).toMatchObject({ row: 6, topRow: 1 });
    const top = run(up, { _tag: "Up", steps: 6 });
    expect(top).toMatchObject({ row: 0, topRow: 0 });
  });
});

describe("left and right", () => {
  it("moves to the next programme and anchors at its start", () => {
    const right = run(start(), { _tag: "Right" });
    expect(right).toMatchObject({ programme: 1, anchor: at("06:20"), viewStart: at("05:30") });
  });

  it("scrolls back to show a programme that starts left of the viewport", () => {
    const left = run(start(), { _tag: "Right" }, { _tag: "Left" });
    expect(left).toMatchObject({ programme: 0, anchor: at("04:55"), viewStart: at("04:30") });
  });

  it("scrolls forward when the next programme starts in the last slot", () => {
    const cursor = run(start(), { _tag: "Right", steps: 3 });
    expect(cursor).toMatchObject({ programme: 3, anchor: at("08:00"), viewStart: at("07:30") });
  });

  it("returns the same object at the first and last programme", () => {
    const first = run(start(), { _tag: "Right" }, { _tag: "Left" });
    expect(step(guide, config, first, { _tag: "Left" })).toBe(first);
    const last = run(start(), { _tag: "Right", steps: 10 });
    expect(last.programme).toBe(3);
    expect(step(guide, config, last, { _tag: "Right" })).toBe(last);
  });

  it("does nothing on a channel without data", () => {
    const empty = makeGuide([channel("empty", 1, [])]);
    const cursor = initialCursor(empty, config, NOW);
    expect(step(empty, config, cursor, { _tag: "Right" })).toBe(cursor);
    expect(step(empty, config, cursor, { _tag: "Left" })).toBe(cursor);
    const inGuide = run(start(), { _tag: "Down", steps: 2 });
    expect(run(inGuide, { _tag: "Right" })).toBe(inGuide);
    expect(run(inGuide, { _tag: "Left" })).toBe(inGuide);
  });

  it("leaves a gap for the programme after it (right) or before it (left)", () => {
    const gap = run(start(), { _tag: "Down", steps: 3 });
    const right = run(gap, { _tag: "Right" });
    expect(right).toMatchObject({ programme: 1, anchor: at("07:00"), viewStart: at("05:30") });
    expect(focusedId(right)).toBe("gap@07:00");
    expect(run(gap, { _tag: "Right", steps: 5 })).toEqual(right);
    const left = run(gap, { _tag: "Left" });
    expect(left).toMatchObject({ programme: 0, anchor: at("05:00"), viewStart: at("05:00") });
    expect(focusedId(left)).toBe("gap@05:00");
  });

  it("returns the same object from a gap with nothing that way", () => {
    // A full second channel keeps 06:12 inside the guide's data.
    const onFirst = (on: Guide) =>
      step(on, config, initialCursor(on, config, NOW, 1), { _tag: "Up" });
    const ended = makeGuide([channel("a", 1, [["05:00", "06:00"]]), hourly("b", 2)]);
    const cursor = onFirst(ended);
    expect(cursor).toMatchObject({ row: 0, programme: -1, anchor: NOW });
    expect(step(ended, config, cursor, { _tag: "Right" })).toBe(cursor);
    expect(step(ended, config, cursor, { _tag: "Left" }).programme).toBe(0);
    const later = makeGuide([channel("a", 1, [["07:00", "08:00"]]), hourly("b", 2)]);
    const before = onFirst(later);
    expect(before).toMatchObject({ row: 0, programme: -1 });
    expect(step(later, config, before, { _tag: "Left" })).toBe(before);
    expect(step(later, config, before, { _tag: "Right" }).programme).toBe(0);
  });
});

describe("page up and down", () => {
  it("moves seven rows and scrolls the viewport with the cursor", () => {
    const down = run(start(), { _tag: "PageDown" });
    expect(down).toMatchObject({ row: 7, topRow: 7, anchor: NOW });
    const again = run(down, { _tag: "PageDown" });
    expect(again).toMatchObject({ row: 14, topRow: 14 });
  });

  it("clamps at the last row and the last full page", () => {
    const end = run(start(), { _tag: "Channel", number: 216 }, { _tag: "PageDown" });
    expect(end).toMatchObject({ row: 24, topRow: 18 });
    expect(step(guide, config, end, { _tag: "PageDown" })).toBe(end);
  });

  it("lands on rows that air nothing at the anchor, on their empty space", () => {
    // Seven rows up from row 10 is row 3, which is in its gap.
    const from = run(start(), { _tag: "Channel", number: 205 });
    expect(from.row).toBe(10);
    expect(run(from, { _tag: "PageUp" })).toMatchObject({
      row: 3,
      programme: -1,
      anchor: NOW,
      topRow: 0,
    });
  });

  it("lands on rows without any data", () => {
    const sparse = makeGuide([
      channel("a", 1, [["06:00", "07:00"]]),
      channel("b", 2, [["06:00", "07:00"]]),
      channel("c", 3, []),
      channel("d", 4, []),
    ]);
    const paging = { ...config, pageRows: 3 };
    const cursor = initialCursor(sparse, paging, NOW);
    const paged = step(sparse, paging, cursor, { _tag: "PageDown" });
    expect(paged).toMatchObject({ row: 3, programme: -1, anchor: NOW });
    expect(step(sparse, paging, paged, { _tag: "PageUp" })).toMatchObject({ row: 0, programme: 0 });
  });
});

describe("day jumps", () => {
  it("moves anchor and viewport by a day on the same channel", () => {
    const cursor = run(start(), { _tag: "Channel", number: 200 });
    const tomorrow = run(cursor, { _tag: "DayForward" });
    expect(tomorrow).toMatchObject({
      row: 5,
      programme: 30,
      anchor: NOW + DAY,
      viewStart: at("05:30") + DAY,
    });
    expect(run(tomorrow, { _tag: "DayBack" })).toEqual(cursor);
  });

  it("stays on a channel with nothing on the new day, on its empty space", () => {
    const tomorrow = run(start(), { _tag: "DayForward" });
    expect(tomorrow).toMatchObject({ row: 0, programme: -1, anchor: NOW + DAY });
    expect(run(tomorrow, { _tag: "DayBack" })).toEqual(start());
  });

  it("clamps to the end of the data, then stops", () => {
    const last = run(start(5), { _tag: "DayForward" }, { _tag: "DayForward" });
    expect(last.anchor).toBe(guide.end - 1);
    expect(last.programme).toBe(47);
    expect(step(guide, config, last, { _tag: "DayForward" })).toBe(last);
  });

  it("clamps to the start of the data going back", () => {
    const first = run(start(5), { _tag: "DayBack" });
    expect(first).toMatchObject({ anchor: guide.start, programme: 0, viewStart: guide.start });
  });
});

describe("jump to now", () => {
  it("brings the cursor back to now on the same channel", () => {
    const away = run(start(5), { _tag: "Right", steps: 4 }, { _tag: "DayForward" });
    expect(isAtNow(guide, config, away, NOW)).toBe(false);
    const now = run(away, { _tag: "Now", now: NOW });
    expect(now).toMatchObject({ row: 5, anchor: NOW, viewStart: at("05:30") });
    expect(isAtNow(guide, config, now, NOW)).toBe(true);
  });

  it("counts a row's empty space at now as now, so Back can leave", () => {
    const empty = run(start(), { _tag: "Down", steps: 2 });
    expect(isAtNow(guide, config, empty, NOW)).toBe(true);
    const away = run(empty, { _tag: "DayForward" });
    expect(isAtNow(guide, config, away, NOW)).toBe(false);
    const back = run(away, { _tag: "Now", now: NOW });
    expect(back).toMatchObject({ row: 2, programme: -1, anchor: NOW });
    expect(isAtNow(guide, config, back, NOW)).toBe(true);
  });

  it("is false once the focused programme has ended", () => {
    const cursor = start();
    expect(isAtNow(guide, config, cursor, NOW)).toBe(true);
    expect(isAtNow(guide, config, cursor, at("06:25"))).toBe(false);
  });
});

describe("jump to channel number", () => {
  it("lands on the channel at the current time and scrolls to it", () => {
    const cursor = run(start(), { _tag: "Channel", number: 210 });
    expect(cursor).toMatchObject({ row: 15, anchor: NOW, topRow: 9 });
    expect(focusedId(cursor)).toBe("h10@6");
  });

  it("lands on a channel in a gap, on its empty space at the same time", () => {
    const cursor = run(start(), { _tag: "Channel", number: 7 });
    expect(cursor).toMatchObject({ row: 3, programme: -1, anchor: NOW });
  });

  it("lands on the channel typed even without data", () => {
    const cursor = run(start(), { _tag: "Channel", number: 3 });
    expect(cursor).toMatchObject({ row: 2, programme: -1, anchor: NOW });
    expect(focusedCell(guide, cursor)?.channel.id).toBe("empty");
  });

  it("takes the next higher number, or the last row", () => {
    expect(rowForChannelNumber(guide.channels, 5)).toBe(3);
    expect(rowForChannelNumber(guide.channels, 131)).toBe(5);
    expect(rowForChannelNumber(guide.channels, 9999)).toBe(24);
    expect(rowForChannelNumber([], 1)).toBe(-1);
  });
});

describe("relocate", () => {
  it("follows the channel by id after a refresh changes the rows", () => {
    const cursor = run(start(), { _tag: "Channel", number: 130 });
    const refreshed = makeGuide(guide.channels.filter((row) => row.id !== "zdf"));
    const moved = relocate(guide, refreshed, config, cursor);
    expect(refreshed.channels[moved.row]?.id).toBe("e1");
    expect(moved.anchor).toBe(NOW);
  });

  it("stays on a channel whose programmes went away", () => {
    const cursor = run(start(), { _tag: "Channel", number: 130 });
    const refreshed = makeGuide(
      guide.channels.map((row) => (row.id === "e1" ? { ...row, programmes: [] } : row)),
    );
    const moved = relocate(guide, refreshed, config, cursor);
    expect(moved).toMatchObject({ row: 4, programme: -1, anchor: NOW });
  });

  it("survives the guide emptying out", () => {
    const moved = relocate(guide, makeGuide([]), config, start(10));
    expect(moved).toMatchObject({ row: 0, programme: -1, topRow: 0 });
  });
});

describe("emptySpan", () => {
  it("covers the viewport on a channel without data", () => {
    const empty = run(start(), { _tag: "Down", steps: 2 });
    expect(emptySpan(guide, config, empty)).toEqual({ start: at("05:30"), end: at("08:30") });
  });

  it("covers the gap between programmes, cut to the viewport", () => {
    const gap = run(start(), { _tag: "Down", steps: 3 });
    expect(emptySpan(guide, config, gap)).toEqual({ start: at("06:00"), end: at("07:00") });
    const ended = makeGuide([channel("a", 1, [["05:00", "06:00"]]), hourly("b", 2)]);
    const after = initialCursor(ended, config, NOW);
    expect(after.row).toBe(1);
    const top = step(ended, config, after, { _tag: "Up" });
    expect(emptySpan(ended, config, top)).toEqual({ start: at("06:00"), end: at("08:30") });
  });

  it("is undefined while a programme has the focus", () => {
    expect(emptySpan(guide, config, start())).toBeUndefined();
  });
});

/** Small deterministic PRNG so the walk is the same on every run. */
const random = (seed: number) => () => {
  seed = (seed * 16_807) % 2_147_483_647;
  return seed / 2_147_483_647;
};

/** Names of the cursor invariants this cursor breaks. */
const brokenInvariants = (on: Guide, settings: GuideConfig, cursor: GuideCursor): string[] => {
  const programmes = on.channels[cursor.row]?.programmes ?? [];
  const checks: [string, boolean][] = [
    ["anchor before view", cursor.anchor < cursor.viewStart],
    ["anchor after view", cursor.anchor >= cursor.viewStart + settings.visibleSpan],
    ["row above viewport", cursor.row < cursor.topRow],
    ["row below viewport", cursor.row >= cursor.topRow + settings.visibleRows],
    ["top row too far", cursor.topRow > Math.max(0, on.channels.length - settings.visibleRows)],
    [
      "focused programme not at anchor",
      cursor.programme !== programmeIndexAt(programmes, cursor.anchor),
    ],
  ];
  return checks.filter(([, broken]) => broken).map(([name]) => name);
};

/** A random action drawn from `next`. */
const randomAction = (next: () => number): GuideAction => {
  const pick = Math.floor(next() * 11);
  const steps = 1 + Math.floor(next() * 3);
  const choices: GuideAction[] = [
    { _tag: "Up", steps },
    { _tag: "Down", steps },
    { _tag: "Left", steps },
    { _tag: "Right", steps },
    { _tag: "Left" },
    { _tag: "Right" },
    { _tag: "PageUp" },
    { _tag: "PageDown" },
    next() < 0.5 ? { _tag: "DayBack" } : { _tag: "DayForward" },
    { _tag: "Now", now: guide.start + next() * (guide.end - guide.start) },
    { _tag: "Channel", number: Math.floor(next() * 240) },
  ];
  return choices[pick] ?? { _tag: "Up" };
};

/** Walks `count` random actions and lists every invariant broken along the way. */
const walk = (
  on: Guide,
  settings: GuideConfig,
  first: GuideCursor,
  seed: number,
  count = 1500,
): string[] => {
  const next = random(seed);
  const broken = brokenInvariants(on, settings, first);
  let cursor = first;
  for (let index = 0; index < count; index++) {
    const action = randomAction(next);
    cursor = step(on, settings, cursor, action);
    for (const name of brokenInvariants(on, settings, cursor)) {
      broken.push(`${name} after ${action._tag} (step ${index})`);
    }
  }
  return broken;
};

describe("random walks", () => {
  it.each([1, 2, 3, 42])("keeps every invariant for seed %i", (seed) => {
    expect(walk(guide, config, start(), seed)).toEqual([]);
  });

  it("keeps the invariants with a small viewport and ragged data", () => {
    const small: GuideConfig = { ...config, visibleRows: 3, pageRows: 2 };
    const ragged = makeGuide([
      channel("a", 1, [
        ["05:00", "05:10"],
        ["05:10", "05:20"],
        ["09:00", "12:00"],
      ]),
      channel("b", 2, []),
      hourly("c", 3, 30),
      channel("d", 4, [["00:00", "30:00"]]),
    ]);
    expect(walk(ragged, small, initialCursor(ragged, small, at("05:05")), 7)).toEqual([]);
  });
});
