import { describe, expect, it } from "vitest";
import { channels, findChannel, type FakeChannel } from "./channels.ts";
import { programmeAt, programmesBetween } from "./schedule.ts";
import { clockTime, xmltvTimestamp, zonedInstant } from "./time.ts";

const tz = "Europe/Berlin";
const now = new Date("2026-11-21T11:00:00Z");
const in48h = new Date(now.getTime() + 48 * 3_600_000);

const channel = (id: string): FakeChannel => {
  const found = findChannel(id);
  if (!found) throw new Error(`no channel ${id}`);
  return found;
};

describe("programmesBetween", () => {
  it("covers 48 hours of every channel back to back, without gaps or overlaps", () => {
    for (const each of channels) {
      const programmes = programmesBetween(each, now, in48h, tz);
      expect(programmes.length).toBeGreaterThan(5);
      expect(programmes[0]?.start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(programmes.at(-1)?.stop.getTime()).toBeGreaterThanOrEqual(in48h.getTime());
      const starts = programmes.map((programme) => programme.start.getTime());
      const stops = programmes.map((programme) => programme.stop.getTime());
      // Each programme starts exactly when the one before it stops.
      expect(starts.slice(1)).toEqual(stops.slice(0, -1));
      expect(programmes.filter((programme) => programme.stop <= programme.start)).toEqual([]);
      expect(new Set(programmes.map((programme) => programme.channelId))).toEqual(
        new Set([each.tvgId]),
      );
    }
  });

  it("is a pure function of the day: two calls agree", () => {
    const f1 = channel("sportkanal-f1");
    expect(programmesBetween(f1, now, in48h, tz)).toEqual(programmesBetween(f1, now, in48h, tz));
  });

  it("airs a race weekend on the F1 channel within any 72 hours", () => {
    const titles = programmesBetween(
      channel("sportkanal-f1"),
      now,
      new Date(now.getTime() + 72 * 3_600_000),
      tz,
    ).map((programme) => programme.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Live F1: 1. Freies Training - GP Katar",
        "Live F1: Qualifying - GP Katar",
        "F1: Pressekonferenz Qualifying - GP Katar",
        "F1: Rennen Kompakt - GP Katar",
        "Live F1: Rennen - GP Katar",
      ]),
    );
  });

  it("schedules the qualifying at 16:00 local time on qualifying days", () => {
    const qualifying = programmesBetween(channel("sportkanal-f1"), now, in48h, tz).find(
      (programme) => programme.title === "Live F1: Qualifying - GP Katar",
    );
    expect(qualifying && clockTime(qualifying.start, tz)).toBe("16:00");
    expect(qualifying && clockTime(qualifying.stop, tz)).toBe("17:15");
    expect(qualifying?.categories).toContain("Motorsport");
  });

  it("gives series episode numbers, films the Spielfilm category and kids their own", () => {
    const series = programmesBetween(channel("serienwelt"), now, in48h, tz);
    expect(series.every((programme) => programme.episode && programme.subTitle)).toBe(true);
    const outOfRange = series.filter(
      ({ episode }) => !episode || episode.episode < 1 || episode.episode > episode.episodes,
    );
    expect(outOfRange).toEqual([]);
    const films = programmesBetween(channel("kino-klassik"), now, in48h, tz).filter(
      (programme) => programme.year !== undefined,
    );
    expect(films.length).toBeGreaterThan(10);
    expect(films.every((film) => film.categories[0] === "Spielfilm" && film.director)).toBe(true);
    const premiere = films.find((film) => clockTime(film.start, tz) === "20:15");
    expect(premiere?.previouslyShown).toBe(false);
    const kids = programmesBetween(channel("kunterbunt"), now, in48h, tz);
    expect(kids.some((programme) => programme.categories.includes("Kinder"))).toBe(true);
    expect(kids.some((programme) => programme.title === "Sendepause")).toBe(true);
  });

  it("replays the race the same evening, marked as a repeat", () => {
    const f1 = programmesBetween(
      channel("sportkanal-f1"),
      now,
      new Date(now.getTime() + 72 * 3_600_000),
      tz,
    );
    const race = f1.find((programme) => programme.title === "Live F1: Rennen - GP Katar");
    const replay = f1.find((programme) => programme.title === "F1: Rennen - GP Katar (Wh.)");
    expect(race && replay).toBeTruthy();
    expect(replay?.previouslyShown).toBe(true);
    expect(race?.previouslyShown).toBeFalsy();
    // Same evening, after the live race.
    expect(replay && clockTime(replay.start, tz)).toBe("20:00");
    expect(replay && race && replay.start.getTime() - race.stop.getTime()).toBeGreaterThan(0);
    expect(replay && race && replay.start.getTime() - race.start.getTime()).toBeLessThan(
      12 * 3_600_000,
    );
  });

  it("repeats yesterday's prime-time episode on the regional channel", () => {
    const regional = programmesBetween(channel("regional"), now, in48h, tz);
    const series = programmesBetween(
      channel("serienwelt"),
      new Date(now.getTime() - 24 * 3_600_000),
      in48h,
      tz,
    );
    const repeat = regional.find((programme) => clockTime(programme.start, tz) === "23:00");
    expect(repeat?.previouslyShown).toBe(true);
    const original = series.find(
      (programme) =>
        clockTime(programme.start, tz) === "20:15" &&
        programme.start < (repeat?.start ?? now) &&
        (repeat?.start.getTime() ?? 0) - programme.start.getTime() < 48 * 3_600_000,
    );
    expect(original).toBeDefined();
    expect(repeat).toMatchObject({
      title: original?.title,
      subTitle: original?.subTitle,
      description: original?.description,
      episode: original?.episode,
    });
  });

  it("gives the weekday magazine one sub-title and a new description every day", () => {
    const week = programmesBetween(
      channel("regional"),
      now,
      new Date(now.getTime() + 7 * 24 * 3_600_000),
      tz,
    ).filter((programme) => programme.subTitle === "Das Magazin");
    expect(week).toHaveLength(5);
    expect(new Set(week.map((programme) => programme.title))).toEqual(new Set(["Landesschau"]));
    expect(new Set(week.map((programme) => programme.description)).size).toBeGreaterThan(1);
    const weekdays = week.map((programme) =>
      new Intl.DateTimeFormat("en", { weekday: "short", timeZone: tz }).format(programme.start),
    );
    expect(weekdays.toSorted()).toEqual(["Fri", "Mon", "Thu", "Tue", "Wed"]);
  });

  it("runs news on the hour", () => {
    const news = programmesBetween(channel("nachrichten-24"), now, in48h, tz).filter((programme) =>
      programme.title.startsWith("Nachrichten"),
    );
    expect(news).toHaveLength(48);
    expect(news.every((programme) => clockTime(programme.start, tz).endsWith(":00"))).toBe(true);
  });

  it("has two-minute programmes on the short channel", () => {
    const at = new Date("2026-11-21T13:05:30Z");
    const programme = programmeAt(channel("testbild-kurz"), at, tz);
    expect(programme?.title).toBe("Kurzsendung 14:04");
    expect((programme?.stop.getTime() ?? 0) - (programme?.start.getTime() ?? 0)).toBe(120_000);
  });

  it("keeps local times across the switch to summer time", () => {
    const night = new Date("2027-03-27T12:00:00Z");
    const programmes = programmesBetween(
      channel("kino-klassik"),
      night,
      new Date(night.getTime() + 48 * 3_600_000),
      tz,
    );
    const atQuarterPastEight = programmes.filter(
      (programme) => clockTime(programme.start, tz) === "20:15",
    );
    // 20:15 CET on Saturday is 19:15 UTC, 20:15 CEST on Sunday is 18:15 UTC.
    expect(atQuarterPastEight.map((programme) => programme.start.toISOString())).toEqual([
      "2027-03-27T19:15:00.000Z",
      "2027-03-28T18:15:00.000Z",
    ]);
  });
});

describe("time", () => {
  it("formats XMLTV timestamps with the zone offset of the day", () => {
    expect(xmltvTimestamp(new Date("2026-11-21T15:00:00Z"), tz)).toBe("20261121160000 +0100");
    expect(xmltvTimestamp(new Date("2026-07-01T15:00:00Z"), tz)).toBe("20260701170000 +0200");
    expect(xmltvTimestamp(new Date("2026-07-01T15:00:00Z"), "America/New_York")).toBe(
      "20260701110000 -0400",
    );
  });

  it("finds the instant of a local wall time", () => {
    expect(zonedInstant({ year: 2026, month: 11, day: 21 }, 16 * 60, tz).toISOString()).toBe(
      "2026-11-21T15:00:00.000Z",
    );
    expect(zonedInstant({ year: 2026, month: 11, day: 21 }, 24 * 60, tz).toISOString()).toBe(
      "2026-11-21T23:00:00.000Z",
    );
  });
});
