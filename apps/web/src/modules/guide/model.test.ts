import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import type { RecordingEntry, ScheduleConflict } from "@slipstream/api";
import {
  type Channel,
  ChannelId,
  type Programme,
  ProgrammeId,
  programmeMarks,
  RecordingId,
} from "@slipstream/domain";
import {
  channelColumnWidth,
  dayKey,
  dayOf,
  firstClearTick,
  visibleChannels,
  gridWindow,
  guideDays,
  inCategory,
  initialPosition,
  moveInGrid,
  narrowChannelColumn,
  type NavCell,
  nextAfter,
  pickCategory,
  pickDay,
  pickSlot,
  pixelsPerMinute,
  placeRow,
  primeTime,
  programmeAt,
  requestWindow,
  rowsByChannel,
  rulerTicks,
  scrollLeftFor,
  slotsFor,
  slotTime,
  timeOnDay,
  visibleDayAt,
  windowWidth,
} from "./model.ts";

/** Local wall-clock time on Sunday 22 November 2026 (tests run in any time zone). */
const local = (hours: number, minutes = 0, day = 22) =>
  new Date(2026, 10, day, hours, minutes).getTime();
const now = local(18, 42);

const programme = (
  title: string,
  start: number,
  end: number,
  extra: Partial<Programme> = {},
): Programme => ({
  id: ProgrammeId.make(`${extra.channelId ?? "arte"}:${title}`),
  channelId: ChannelId.make("arte"),
  start: DateTime.makeUnsafe(start),
  end: DateTime.makeUnsafe(end),
  title,
  categories: [],
  repeat: false,
  live: false,
  ...extra,
});

/** Wall-clock time in Berlin in November (CET, UTC+1), whatever zone the tests run in. */
const zone = "Europe/Berlin";
const berlin = (hours: number, minutes = 0, day = 22) =>
  Date.UTC(2026, 10, day, hours - 1, minutes);
const evening = berlin(18, 42);

describe("days", () => {
  it("lists today and the next seven household days with weekday and date", () => {
    const days = guideDays(evening, zone);
    expect(days).toHaveLength(8);
    expect(days[0]).toMatchObject({ key: "2026-11-22", offset: 0, weekday: "sun", date: 22 });
    expect(days[1]).toMatchObject({ key: "2026-11-23", offset: 1, weekday: "mon", date: 23 });
    expect(days[0]?.start).toBe(berlin(0));
    expect(days[0]?.end).toBe(berlin(0, 0, 23));
  });

  it("counts days in the household's zone, not the browser's", () => {
    // 23:30 in Berlin is already Monday; in New York it is still Sunday afternoon.
    const late = berlin(23, 30);
    expect(guideDays(late, zone)[0]).toMatchObject({ key: "2026-11-22", weekday: "sun" });
    expect(guideDays(late + 60 * 60_000, zone)[0]).toMatchObject({ key: "2026-11-23" });
    expect(guideDays(late + 60 * 60_000, "America/New_York")[0]).toMatchObject({
      key: "2026-11-22",
    });
  });

  it("gives DST change days their real length", () => {
    // Berlin falls back on Sunday 25 October 2026: that day has 25 hours.
    const days = guideDays(Date.UTC(2026, 9, 24, 10), zone);
    const fallBack = days.find((day) => day.key === "2026-10-25");
    expect(fallBack && fallBack.end - fallBack.start).toBe(25 * 60 * 60_000);
    expect(fallBack?.start).toBe(Date.UTC(2026, 9, 24, 22));
    expect(fallBack && timeOnDay(fallBack, 20, 15)).toBe(Date.UTC(2026, 9, 25, 19, 15));
    // And springs forward on Sunday 28 March 2027: 23 hours.
    const spring = guideDays(Date.UTC(2027, 2, 27, 10), zone)[1];
    expect(spring).toMatchObject({ key: "2027-03-28", offset: 1 });
    expect(spring && spring.end - spring.start).toBe(23 * 60 * 60_000);
  });

  it("falls back to today for a missing or stale day", () => {
    const days = guideDays(evening, zone);
    expect(pickDay(days, "2026-11-25").offset).toBe(3);
    expect(pickDay(days, undefined).offset).toBe(0);
    expect(pickDay(days, "2025-01-01").offset).toBe(0);
  });

  it("names any moment's day relative to today", () => {
    expect(dayOf(berlin(20, 15, 23), evening, zone)).toMatchObject({
      offset: 1,
      weekday: "mon",
      date: 23,
    });
    expect(dayOf(berlin(9, 0, 21), evening, zone)).toMatchObject({ offset: -1, weekday: "sat" });
    expect(dayKey(berlin(23, 59), zone)).toBe("2026-11-22");
    expect(dayKey(berlin(0, 1, 23), zone)).toBe("2026-11-23");
  });
});

describe("slots", () => {
  const [today, tomorrow] = guideDays(evening, zone);
  if (!today || !tomorrow) throw new Error("no days");

  it("defaults to now today and to prime time on other days", () => {
    expect(pickSlot(undefined, today)).toBe("now");
    expect(pickSlot(undefined, tomorrow)).toBe("20:15");
    expect(pickSlot("now", tomorrow)).toBe("20:15");
    expect(pickSlot("22:00", tomorrow)).toBe("22:00");
    expect(pickSlot("nonsense", today)).toBe("now");
  });

  it("takes any picked time of day from the URL, and nothing that is not one", () => {
    expect(pickSlot("21:30", tomorrow)).toBe("21:30");
    expect(pickSlot("07:05", today)).toBe("07:05");
    expect(pickSlot("24:00", today)).toBe("now");
    expect(pickSlot("9:30", today)).toBe("now");
    expect(slotTime("21:30", tomorrow, evening)).toBe(timeOnDay(tomorrow, 21, 30));
  });

  it("offers now only on today", () => {
    expect(slotsFor(today)).toEqual(["now", "19:00", "20:15", "22:00"]);
    expect(slotsFor(tomorrow)).toEqual(["19:00", "20:15", "22:00"]);
  });

  it("turns a slot into a household wall-clock moment on the day", () => {
    expect(slotTime("now", today, evening)).toBe(evening);
    expect(slotTime("19:00", today, evening)).toBe(berlin(19));
    expect(slotTime("20:15", tomorrow, evening)).toBe(berlin(20, 15, 23));
    expect(primeTime(today)).toBe(berlin(20, 15));
  });
});

describe("categories", () => {
  it("reads the genre like the artwork does: categories first, then the title", () => {
    expect(inCategory(programme("Sportschau", 0, 1, { categories: ["Sport"] }), "sport")).toBe(
      true,
    );
    expect(inCategory(programme("Live F1: Rennen", 0, 1), "sport")).toBe(true);
    expect(inCategory(programme("Der Pate", 0, 1, { categories: ["Spielfilm"] }), "film")).toBe(
      true,
    );
    expect(inCategory(programme("Der Pate", 0, 1, { categories: ["Spielfilm"] }), "news")).toBe(
      false,
    );
    expect(inCategory(programme("Anything", 0, 1), "all")).toBe(true);
  });

  it("drops unknown categories", () => {
    expect(pickCategory("kids")).toBe("kids");
    expect(pickCategory("cooking")).toBe("all");
  });
});

const channel = (id: string, number: number | undefined, hidden = false): Channel => ({
  id: ChannelId.make(id),
  name: id,
  ...(number === undefined ? {} : { number }),
  favourite: false,
  hidden,
});

describe("channels and rows", () => {
  it("lists visible channels by number, unnumbered last", () => {
    const listed = visibleChannels([
      channel("zdf", 2),
      channel("shop", 99, true),
      channel("misc", undefined),
      channel("ard", 1),
    ]);
    expect(listed.map((c) => c.id)).toEqual(["ard", "zdf", "misc"]);
  });

  it("orders each row and finds what airs at a moment and what follows", () => {
    const late = programme("Late", local(20), local(21));
    const early = programme("Early", local(18), local(20));
    const row = rowsByChannel([late, early]).get("arte") ?? [];
    expect(row.map((p) => p.title)).toEqual(["Early", "Late"]);
    expect(programmeAt(row, now)?.title).toBe("Early");
    expect(programmeAt(row, local(17))).toBeUndefined();
    expect(nextAfter(row, early)?.title).toBe("Late");
  });
});

/** Just the fields markers read; the rest of an entry doesn't matter here. */
const entry = (id: string, programmeId: string, state: RecordingEntry["state"]) =>
  ({
    id: RecordingId.make(id),
    programmeId: ProgrammeId.make(programmeId),
    state,
  }) as RecordingEntry;

describe("markers", () => {
  it("marks recording, scheduled and conflicting programmes, nothing for finished ones", () => {
    const conflicts: ScheduleConflict[] = [
      {
        range: { start: DateTime.makeUnsafe(local(20)), end: DateTime.makeUnsafe(local(20, 15)) },
        channelIds: [],
        recordingIds: [RecordingId.make("c")],
        sourceIds: [],
        capacity: 0,
      },
    ];
    const marks = programmeMarks(
      [
        entry("a", "p-rec", "recording"),
        entry("b", "p-sched", "scheduled"),
        entry("c", "p-conf", "scheduled"),
        entry("d", "p-done", "completed"),
      ],
      conflicts,
    );
    expect(marks.get("p-rec")?.state).toBe("recording");
    expect(marks.get("p-sched")?.state).toBe("scheduled");
    expect(marks.get("p-conf")?.state).toBe("conflict");
    expect(marks.has("p-done")).toBe(false);
  });
});

describe("grid geometry", () => {
  const window = { from: local(18), to: local(22) };

  it("uses 5 px a minute and a 208 px column on desktop, a narrow 96 px one below", () => {
    expect(pixelsPerMinute(true)).toBe(5);
    expect(pixelsPerMinute(false)).toBe(4);
    expect(channelColumnWidth(true, false)).toBe(208);
    expect(channelColumnWidth(false, false)).toBe(96);
    expect(channelColumnWidth(true, true)).toBe(96);
    expect(narrowChannelColumn(true, false)).toBe(false);
    expect(narrowChannelColumn(false, false)).toBe(true);
    expect(windowWidth(window, 5)).toBe(240 * 5);
  });

  it("places cells in pixels with a 2 px gutter and sizes them micro, tiny or full", () => {
    const cells = placeRow(
      [
        programme("Wetter", local(19, 55), local(20)),
        programme("heute", local(19), local(19, 10)),
        programme("Film", local(20), local(22)),
      ],
      window,
      now,
      5,
      new Map(),
    );
    expect(cells.map((cell) => [cell.programme.title, cell.size])).toEqual([
      ["heute", "tiny"],
      ["Wetter", "micro"],
      ["Film", "full"],
    ]);
    expect(cells[0]?.x).toBe(60 * 5 + 2);
    expect(cells[0]?.width).toBe(10 * 5 - 4);
    expect(cells[0]?.when).toBe("future");
    expect(cells[2]?.when).toBe("future");
    const tiny = placeRow([programme("Kurz", local(20), local(20, 15))], window, now, 4, new Map());
    expect(tiny[0]?.size).toBe("tiny");
  });

  it("cuts programmes at the window's edges, orders them and drops empty ones", () => {
    const cells = placeRow(
      [
        programme("Late", local(21, 30), local(23)),
        programme("Early", local(17), local(18, 30)),
        programme("Gone", local(15), local(16)),
        programme("Zero", local(20), local(20)),
        programme("Middle", local(18, 30), local(19, 30)),
      ],
      window,
      local(18, 45),
      5,
      new Map(),
    );
    expect(cells.map((cell) => cell.programme.title)).toEqual(["Early", "Middle", "Late"]);
    expect(cells.map((cell) => [cell.x, cell.width])).toEqual([
      [2, 30 * 5 - 4],
      [30 * 5 + 2, 60 * 5 - 4],
      [210 * 5 + 2, 30 * 5 - 4],
    ]);
    expect(cells[0]).toMatchObject({ when: "past", progress: 1 });
    expect(cells[1]).toMatchObject({ when: "airing", progress: 0.25 });
    expect(cells[2]).toMatchObject({ when: "future", progress: 0 });
  });

  it("hides the ruler labels the now chip would cover", () => {
    const ticks = rulerTicks(window, 5, ((now - window.from) / 60_000) * 5);
    const covered = ticks.filter((tick) => tick.covered).map((tick) => tick.at);
    expect(covered).toEqual([local(18, 30)]);
    expect(ticks[1]?.half).toBe(true);
    expect(ticks[2]?.half).toBe(false);
  });

  it("scrolls to show 40 minutes before a moment", () => {
    expect(scrollLeftFor(window, local(19), 5)).toBe(20 * 5);
    expect(scrollLeftFor(window, local(18, 10), 5)).toBe(0);
  });
});

const cell = (id: string, startH: number, startM: number, endH: number, endM: number): NavCell => ({
  id,
  start: local(startH, startM),
  end: local(endH, endM),
});

describe("keyboard", () => {
  const rows: NavCell[][] = [
    [cell("a1", 17, 15, 19, 57), cell("a2", 19, 57, 20, 15)],
    [],
    [cell("c1", 18, 0, 18, 50), cell("c2", 18, 50, 19, 0), cell("c3", 19, 0, 20, 0)],
  ];

  it("steps through a row and stops at its ends", () => {
    expect(moveInGrid(rows, { row: 0, index: 0 }, "ArrowRight", now, local(18))).toEqual({
      row: 0,
      index: 1,
    });
    expect(moveInGrid(rows, { row: 0, index: 1 }, "ArrowRight", now, local(18))).toBeUndefined();
    expect(moveInGrid(rows, { row: 0, index: 0 }, "ArrowLeft", now, local(18))).toBeUndefined();
  });

  it("keeps the time position across rows, using now for what airs, and skips empty rows", () => {
    // a1 airs now (18:42), so the cell at 18:42 two rows down is c1.
    expect(moveInGrid(rows, { row: 0, index: 0 }, "ArrowDown", now, local(18))).toEqual({
      row: 2,
      index: 0,
    });
    // a2 starts at 19:57: c3 (19:00 to 20:00) holds that moment.
    expect(moveInGrid(rows, { row: 0, index: 1 }, "ArrowDown", now, local(18))).toEqual({
      row: 2,
      index: 2,
    });
    expect(moveInGrid(rows, { row: 2, index: 1 }, "ArrowUp", now, local(18))).toEqual({
      row: 0,
      index: 0,
    });
    expect(moveInGrid(rows, { row: 0, index: 0 }, "ArrowUp", now, local(18))).toBeUndefined();
  });

  it("starts on the first programme on air", () => {
    expect(initialPosition(rows, now)).toEqual({ row: 0, index: 0 });
    expect(initialPosition([[], [cell("x", 9, 0, 10, 0)]], now)).toEqual({ row: 1, index: 0 });
    expect(initialPosition([[]], now)).toBeUndefined();
  });
});

describe("one timeline across the days", () => {
  const days = guideDays(evening, zone);
  const today = days[0];
  const tomorrow = days[1];
  if (!today || !tomorrow) throw new Error("no days");

  it("asks for every day from today's midnight, within the server's eight days", () => {
    const asked = requestWindow(days);
    expect(asked.from).toBe(berlin(0));
    expect(asked.to - asked.from).toBeLessThanOrEqual(8 * 24 * 60 * 60_000);
  });

  it("ends the grid where the guide data ends, on the half hour, at least after today", () => {
    expect(gridWindow(days, undefined).to).toBe(today.end);
    expect(gridWindow(days, berlin(0, 10, 24)).to).toBe(berlin(0, 30, 24));
  });

  it("names the day a third of the way into the view", () => {
    const window = requestWindow(days);
    // 5 px a minute: a day is 7200 px. The view is 900 px wide, so 300 px in counts.
    expect(visibleDayAt(days, window, 0, 900, 5).key).toBe(today.key);
    expect(visibleDayAt(days, window, 7200 - 300, 900, 5).key).toBe(tomorrow.key);
    expect(visibleDayAt(days, window, 7200 - 301, 900, 5).key).toBe(today.key);
  });

  it("labels each midnight with the day that starts there", () => {
    const ticks = rulerTicks(requestWindow(days), 5, undefined, days);
    expect(ticks[0]?.day?.key).toBe(today.key);
    expect(ticks.find((tick) => tick.at === tomorrow.start)?.day?.key).toBe(tomorrow.key);
    expect(ticks[1]?.day).toBeUndefined();
  });
});

describe("ruler labels under the channel column", () => {
  it("fades every label whose start has scrolled under the column", () => {
    // 5 px a minute: a label every 150 px.
    expect(firstClearTick(0, 5)).toBe(0);
    expect(firstClearTick(150, 5)).toBe(1);
    expect(firstClearTick(151, 5)).toBe(2);
    expect(firstClearTick(299.5, 5)).toBe(2);
    // 4 px a minute (under 1100 px): every 120 px.
    expect(firstClearTick(121, 4)).toBe(2);
  });
});
