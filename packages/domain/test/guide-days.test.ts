import { describe, expect, it } from "vitest";
import { daysAround, gridWindow, guideDays, loadedDays, mergeDays } from "../src/guide-timeline.ts";
import { ChannelId, ProgrammeId } from "../src/ids.ts";
import { type Programme, toGuideEntry } from "../src/programme.ts";
import { DateTime } from "effect";
import { HttpUrl } from "../src/source.ts";

const now = Date.parse("2026-11-24T10:00:00Z");
const days = guideDays(now, "Europe/Berlin");
const HOUR = 3_600_000;

describe("daysAround", () => {
  it("is the day in view and one either side", () => {
    expect(daysAround(days, days[3]?.key).map((day) => day.offset)).toEqual([2, 3, 4]);
  });

  it("stops at the guide's first and last day", () => {
    expect(daysAround(days, days[0]?.key).map((day) => day.offset)).toEqual([0, 1]);
    expect(daysAround(days, days.at(-1)?.key).map((day) => day.offset)).toEqual([6, 7]);
  });

  it("starts at the first day for a day it does not know", () => {
    expect(daysAround(days, undefined).map((day) => day.offset)).toEqual([0, 1]);
  });
});

describe("mergeDays", () => {
  it("keeps a programme over midnight once and skips days not answered yet", () => {
    const a = { id: "a" };
    const overMidnight = { id: "b" };
    const c = { id: "c" };
    expect(mergeDays([[a, overMidnight], undefined, [overMidnight, c]])).toEqual([
      a,
      overMidnight,
      c,
    ]);
  });
});

describe("loadedDays", () => {
  const [today, tomorrow, third] = guideDays(now, "Europe/Berlin", 3);
  if (today === undefined || tomorrow === undefined || third === undefined) {
    throw new Error("no days");
  }
  const late = { id: "late" };
  const overMidnight = { id: "film" };
  const morning = { id: "morning" };

  it("merges the loaded days, a programme over midnight once", () => {
    const result = loadedDays(
      [today, tomorrow, third],
      [[late, overMidnight], [overMidnight, morning], undefined],
      [[], ["morning repeat"], undefined],
    );
    expect(result.programmes.map((entry) => entry.id)).toEqual(["late", "film", "morning"]);
    expect(result.repeats).toEqual(["morning repeat"]);
    expect([...result.loaded]).toEqual([today.key, tomorrow.key]);
    expect(result.pending).toEqual([third]);
  });

  it("holds a day back until its repeat marks are in, so no marker arrives late", () => {
    const result = loadedDays(
      [today, tomorrow, third],
      [[late], [morning], undefined],
      [[], undefined, undefined],
    );
    expect(result.programmes.map((entry) => entry.id)).toEqual(["late"]);
    expect(result.pending).toEqual([tomorrow, third]);
  });
});

describe("gridWindow", () => {
  const first = days[0];
  if (first === undefined) throw new Error("no days");

  it("ends where the guide data ends, on the half hour", () => {
    const end = first.start + 50 * HOUR + 10 * 60_000;
    expect(gridWindow(days, end)).toEqual({ from: first.start, to: first.start + 50.5 * HOUR });
  });

  it("spans at least today, also before the data's end is known", () => {
    expect(gridWindow(days, undefined)).toEqual({ from: first.start, to: first.end });
  });
});

describe("toGuideEntry", () => {
  it("leaves the details out", () => {
    const programme: Programme = {
      id: ProgrammeId.make("p"),
      channelId: ChannelId.make("c"),
      start: DateTime.makeUnsafe(now),
      end: DateTime.makeUnsafe(now + HOUR),
      title: "Tatort",
      subtitle: "Folge 1",
      description: "A long description",
      categories: ["Krimi"],
      repeat: false,
      live: false,
      imageUrl: HttpUrl.make("https://example.test/a.jpg"),
    };
    const entry = toGuideEntry(programme);
    expect(entry).not.toHaveProperty("description");
    expect(entry).not.toHaveProperty("imageUrl");
    expect(entry.subtitle).toBe("Folge 1");
  });
});
