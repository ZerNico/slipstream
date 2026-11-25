import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setLocale } from "@slipstream/i18n";
import { dayHeading, dayPillLabel } from "./labels.ts";
import { dayOf, guideDays, pendingGuideDays, pickDay, slotTime, timeOnDay } from "./model.ts";

/*
 * Household days with a household zone that differs from this process's: the guide must count
 * in Berlin while the process runs in UTC, and never fall back to the process's zone.
 */

const berlin = "Europe/Berlin";
const processZone = process.env["TZ"];
beforeAll(() => {
  process.env["TZ"] = "UTC";
});
afterAll(() => {
  if (processZone === undefined) delete process.env["TZ"];
  else process.env["TZ"] = processZone;
});
afterEach(() => setLocale("en"));

// 21:00 on Monday 23 November 2026 in Berlin (CET, UTC+1), 20:00 in UTC.
const now = Date.UTC(2026, 10, 23, 20);
// 00:30 on Tuesday 24 November in Berlin, still 23:30 on Monday in UTC.
const lateShow = Date.UTC(2026, 10, 23, 23, 30);

describe("a 00:30 Berlin programme, the process in UTC", () => {
  it("falls on the next household day", () => {
    expect(dayOf(lateShow, now, berlin)).toMatchObject({
      key: "2026-11-24",
      offset: 1,
      weekday: "tue",
      date: 24,
      start: Date.UTC(2026, 10, 23, 23),
      end: Date.UTC(2026, 10, 24, 23),
    });
    expect(guideDays(now, berlin)[1]?.key).toBe("2026-11-24");
  });

  it("is named by the pills' notation everywhere", () => {
    const pill = (at: number) => dayPillLabel(dayOf(at, now, berlin));
    expect(pill(lateShow)).toBe("Tue 24");
    expect(pill(now)).toBe("Today 23");
    expect(dayHeading(dayOf(now, now, berlin))).toBe("Today");
    expect(dayHeading(dayOf(lateShow, now, berlin))).toBe("Tue 24");
    setLocale("de");
    expect(pill(lateShow)).toBe("Di 24");
    expect(pill(now)).toBe("Heute 23");
  });
});

describe("stand-in days while the household's zone loads", () => {
  const pending = pendingGuideDays(now);

  it("have the loaded page's count and day windows, and name no household date", () => {
    expect(pending).toHaveLength(8);
    expect(pending.map((day) => day.offset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(pending.every((day) => day.timeZone === undefined)).toBe(true);
    expect(pending.every((day) => day.key.startsWith("pending-"))).toBe(true);
    for (const day of pending) expect(day.end - day.start).toBe(24 * 60 * 60_000);
    expect(pending[0]?.start).toBeLessThanOrEqual(now);
    expect(pending[0]?.end).toBeGreaterThan(now);
  });

  it("never match a day the URL names", () => {
    expect(pickDay(pending, "2026-11-24")).toBe(pending[0]);
  });

  it("place slot times at the same offset into the window, without a zone", () => {
    const [today] = pending;
    if (today === undefined) throw new Error("no stand-in day");
    expect(timeOnDay(today, 20, 15)).toBe(today.start + (20 * 60 + 15) * 60_000);
    expect(slotTime("now", today, now)).toBe(now);
  });
});
