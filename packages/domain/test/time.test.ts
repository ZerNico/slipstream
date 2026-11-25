import { DateTime, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { at, timeZone } from "./test-support.ts";
import {
  calendarDayNumber,
  calendarDayOffset,
  clampPaddingMinutes,
  DAY,
  durationMillis,
  gaps,
  intersection,
  localParts,
  mergeRanges,
  overlaps,
  padRange,
  paddingLimits,
  paddingStepMinutes,
  span,
  startOfCalendarDay,
  stepPaddingMinutes,
  summariseGaps,
  TimeRange,
  totalMillis,
  type TimeRange as Range,
} from "../src/time.ts";

const range = (start: string, end: string): Range => ({ start: at(start), end: at(end) });
const ms = (value: string) => DateTime.toEpochMillis(at(value));
const isoOf = (instant: DateTime.Utc) => DateTime.formatIso(instant);

describe("calendar days in a zone", () => {
  const berlin = "Europe/Berlin";
  const auckland = "Pacific/Auckland";
  const losAngeles = "America/Los_Angeles";

  it("counts the local date, not the UTC one", () => {
    // 23:30 UTC on the 21st is already the 22nd in Berlin.
    const late = at("2026-11-21T23:30:00Z");
    expect(calendarDayNumber(late, berlin) - calendarDayNumber(late, "UTC")).toBe(1);
    expect(calendarDayNumber(ms("2026-11-21T23:30:00Z"), berlin)).toBe(
      calendarDayNumber(late, berlin),
    );
    expect(calendarDayNumber(at("1970-01-01T12:00:00Z"), "UTC")).toBe(0);
  });

  it("puts a 00:30 programme on tomorrow, in zones east and west of UTC", () => {
    // Auckland is UTC+13 in November: 22:00 tonight, then 00:30 tomorrow.
    expect(
      calendarDayOffset(at("2026-11-22T09:00:00Z"), at("2026-11-22T11:30:00Z"), auckland),
    ).toBe(1);
    // Los Angeles is UTC-8: 23:00 tonight, then 00:30 tomorrow.
    expect(
      calendarDayOffset(ms("2026-11-22T07:00:00Z"), ms("2026-11-22T08:30:00Z"), losAngeles),
    ).toBe(1);
    // Berlin: 00:30 local on the 23rd seen from the 22nd evening, and yesterday.
    const now = at("2026-11-22T19:00:00Z");
    expect(calendarDayOffset(now, at("2026-11-22T23:30:00Z"), berlin)).toBe(1);
    expect(calendarDayOffset(now, at("2026-11-22T22:30:00Z"), berlin)).toBe(0);
    expect(calendarDayOffset(now, at("2026-11-21T22:59:00Z"), berlin)).toBe(-1);
  });

  it("finds local midnight, also on DST change days", () => {
    expect(isoOf(startOfCalendarDay(at("2026-11-22T19:00:00Z"), berlin))).toBe(
      "2026-11-21T23:00:00.000Z",
    );
    // Berlin springs forward on 29 March 2026: the day starts at +01:00 and lasts 23 hours.
    const spring = startOfCalendarDay(at("2026-03-29T12:00:00Z"), berlin);
    const nextDay = startOfCalendarDay(at("2026-03-30T12:00:00Z"), berlin);
    expect(isoOf(spring)).toBe("2026-03-28T23:00:00.000Z");
    expect(isoOf(nextDay)).toBe("2026-03-29T22:00:00.000Z");
    // Los Angeles falls back on 1 November 2026: a 25-hour day.
    const fall = startOfCalendarDay(ms("2026-11-01T20:00:00Z"), losAngeles);
    expect(isoOf(fall)).toBe("2026-11-01T07:00:00.000Z");
    expect(isoOf(startOfCalendarDay(at("2026-11-02T20:00:00Z"), losAngeles))).toBe(
      "2026-11-02T08:00:00.000Z",
    );
    // Auckland springs forward on 27 September 2026, midnight is still +12:00.
    expect(isoOf(startOfCalendarDay(at("2026-09-27T06:00:00Z"), auckland))).toBe(
      "2026-09-26T12:00:00.000Z",
    );
  });

  it("never shifts a day across DST, where adding 24 hours would", () => {
    // 00:30 local on 29 March in Berlin, then 24 hours later is 01:30 on the 30th.
    const early = at("2026-03-28T23:30:00Z");
    expect(calendarDayOffset(early, at("2026-03-29T21:30:00Z"), berlin)).toBe(0);
    expect(calendarDayOffset(early, at("2026-03-29T22:30:00Z"), berlin)).toBe(1);
    expect(
      calendarDayOffset(early, DateTime.makeUnsafe(ms("2026-03-28T23:30:00Z") + DAY), berlin),
    ).toBe(1);
  });
});

describe("padding limits", () => {
  it("clamps stepper values to whole minutes between 0 and 240", () => {
    expect(paddingLimits).toEqual({ min: 0, max: 240 });
    expect(clampPaddingMinutes(-5)).toBe(0);
    expect(clampPaddingMinutes(300)).toBe(240);
    expect(clampPaddingMinutes(12.4)).toBe(12);
    expect(clampPaddingMinutes(Number.NaN)).toBe(0);
  });

  it("walks the D-pad steps and holds at the ends", () => {
    expect(paddingStepMinutes).toEqual([0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]);
    expect(stepPaddingMinutes(5, 1)).toBe(10);
    expect(stepPaddingMinutes(5, -1)).toBe(3);
    expect(stepPaddingMinutes(7, 1)).toBe(10);
    expect(stepPaddingMinutes(7, -1)).toBe(5);
    expect(stepPaddingMinutes(240, 1)).toBe(240);
    expect(stepPaddingMinutes(0, -1)).toBe(0);
    expect(stepPaddingMinutes(1000, -1)).toBe(180);
  });
});
const iso = (r: Range) => [DateTime.formatIso(r.start), DateTime.formatIso(r.end)];

describe("time ranges", () => {
  const race = range("2026-11-22T04:00:00Z", "2026-11-22T06:00:00Z");

  it("pads a programme with start-early and keep-after minutes", () => {
    expect(iso(padRange(race, { beforeMinutes: 5, afterMinutes: 60 }))).toEqual([
      "2026-11-22T03:55:00.000Z",
      "2026-11-22T07:00:00.000Z",
    ]);
  });

  it("treats ranges as half-open", () => {
    const after = range("2026-11-22T06:00:00Z", "2026-11-22T07:00:00Z");
    expect(overlaps(race, after)).toBe(false);
    expect(overlaps(race, range("2026-11-22T05:59:00Z", "2026-11-22T07:00:00Z"))).toBe(true);
    expect(intersection(race, after)).toBeUndefined();
  });

  it("intersects and spans ranges", () => {
    const qualifying = range("2026-11-22T05:30:00Z", "2026-11-22T08:00:00Z");
    expect(iso(intersection(race, qualifying)!)).toEqual([
      "2026-11-22T05:30:00.000Z",
      "2026-11-22T06:00:00.000Z",
    ]);
    expect(iso(span(race, qualifying))).toEqual([
      "2026-11-22T04:00:00.000Z",
      "2026-11-22T08:00:00.000Z",
    ]);
    expect(durationMillis(race)).toBe(2 * 3_600_000);
  });

  it("merges overlapping and touching ranges and drops empty ones", () => {
    const merged = mergeRanges([
      range("2026-11-22T05:00:00Z", "2026-11-22T06:00:00Z"),
      range("2026-11-22T04:00:00Z", "2026-11-22T05:00:00Z"),
      range("2026-11-22T07:00:00Z", "2026-11-22T07:00:00Z"),
      range("2026-11-22T08:00:00Z", "2026-11-22T09:00:00Z"),
      range("2026-11-22T08:30:00Z", "2026-11-22T08:45:00Z"),
    ]).map(iso);
    expect(merged).toEqual([
      ["2026-11-22T04:00:00.000Z", "2026-11-22T06:00:00.000Z"],
      ["2026-11-22T08:00:00.000Z", "2026-11-22T09:00:00.000Z"],
    ]);
  });

  it("finds the gaps a stream drop left in a recording", () => {
    const recording = range("2026-11-22T03:55:00Z", "2026-11-22T07:00:00Z");
    const captured = [
      range("2026-11-22T03:50:00Z", "2026-11-22T04:52:00Z"),
      range("2026-11-22T04:54:00Z", "2026-11-22T06:30:00Z"),
    ];
    expect(gaps(recording, captured).map(iso)).toEqual([
      ["2026-11-22T04:52:00.000Z", "2026-11-22T04:54:00.000Z"],
      ["2026-11-22T06:30:00.000Z", "2026-11-22T07:00:00.000Z"],
    ]);
    expect(gaps(recording, [])).toEqual([recording]);
    expect(gaps(race, [range("2026-11-22T00:00:00Z", "2026-11-23T00:00:00Z")])).toEqual([]);
    expect(totalMillis(captured)).toBe((62 + 96) * 60_000);
  });

  it("reads local weekdays across midnight", () => {
    expect(localParts(at("2026-11-21T19:00:00Z"), timeZone)).toMatchObject({
      weekday: "sat",
      hour: 20,
      day: 21,
      month: 11,
    });
    expect(localParts(at("2026-11-21T23:30:00Z"), timeZone).weekday).toBe("sun");
    expect(localParts(at("2026-11-21T23:30:00Z"), "UTC").weekday).toBe("sat");
  });

  it("summarises gaps: unsorted, adjacent and duplicate gaps become one", () => {
    const window = range("2026-11-22T15:55:00Z", "2026-11-22T18:15:00Z");
    const reported = [
      range("2026-11-22T17:09:00Z", "2026-11-22T18:10:00Z"),
      range("2026-11-22T15:55:00Z", "2026-11-22T17:09:00Z"),
      range("2026-11-22T18:10:00Z", "2026-11-22T18:15:00Z"),
      range("2026-11-22T17:09:00Z", "2026-11-22T18:10:00Z"),
    ];
    const summary = summariseGaps(reported, window);
    expect(summary.gaps.map(iso)).toEqual([iso(window)]);
    expect(summary.missingMs).toBe(140 * 60_000);
    expect(summary.coversWindow).toBe(true);
  });

  it("summarises gaps: overlapping ones merge, outside parts are clipped", () => {
    const window = range("2026-11-22T16:00:00Z", "2026-11-22T18:00:00Z");
    const summary = summariseGaps(
      [
        range("2026-11-22T17:30:00Z", "2026-11-22T18:30:00Z"),
        range("2026-11-22T16:10:00Z", "2026-11-22T16:20:00Z"),
        range("2026-11-22T16:15:00Z", "2026-11-22T16:25:00Z"),
        range("2026-11-22T15:00:00Z", "2026-11-22T15:30:00Z"),
        range("2026-11-22T16:10:00Z", "2026-11-22T16:20:00Z"),
      ],
      window,
    );
    expect(summary.gaps.map(iso)).toEqual([
      ["2026-11-22T16:10:00.000Z", "2026-11-22T16:25:00.000Z"],
      ["2026-11-22T17:30:00.000Z", "2026-11-22T18:00:00.000Z"],
    ]);
    expect(summary.missingMs).toBe(45 * 60_000);
    expect(summary.coversWindow).toBe(false);
    expect(summariseGaps([], window)).toEqual({ gaps: [], missingMs: 0, coversWindow: false });
  });

  it("encodes ranges as ISO strings on the wire", () => {
    const encoded = Schema.encodeSync(TimeRange)(race);
    expect(encoded).toEqual({ start: "2026-11-22T04:00:00.000Z", end: "2026-11-22T06:00:00.000Z" });
    expect(iso(Schema.decodeUnknownSync(TimeRange)(encoded))).toEqual(iso(race));
  });
});
