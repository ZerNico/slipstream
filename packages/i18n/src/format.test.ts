import { describe, expect, it } from "vitest";
import { createFormatters } from "./format.ts";

const NBSP = String.fromCodePoint(0xa0);
const MINUS = String.fromCodePoint(0x2212);
const zone = { timeZone: "Europe/Berlin" };
const de = createFormatters("de", { region: "DE", ...zone });
const gb = createFormatters("en", { region: "GB", ...zone });
const us = createFormatters("en", { region: "US", ...zone });

const start = new Date("2026-11-22T04:00:00Z");
const end = new Date("2026-11-22T06:00:00Z");

describe("guide times", () => {
  it("writes 24-hour times and ranges without a trailing Uhr", () => {
    expect(de.time(start)).toBe("05:00");
    expect(de.timeRange(start, end)).toBe("05:00–07:00");
    expect(gb.timeRange(start, end)).toBe("05:00–07:00");
  });

  it("lets 12-hour regions share AM/PM across a range", () => {
    expect(us.time(start)).toMatch(/^5:00\sAM$/u);
    expect(us.timeRange(start, end)).toMatch(/^5:00\s–\s7:00\sAM$/u);
  });

  it("writes guide days and dates the region's way", () => {
    expect(de.day(start)).toBe("So., 22. Nov.");
    expect(gb.day(start)).toBe("Sun 22 Nov");
    expect(de.date(start)).toBe("22.11.2026");
    expect(de.weekdayTime(new Date("2026-11-27T13:30:00Z"))).toBe("Fr., 14:30");
  });

  it("follows the time zone it is given", () => {
    const utc = createFormatters("de", { region: "DE", timeZone: "UTC" });
    expect(utc.time(start)).toBe("04:00");
  });
});

describe("durations and positions", () => {
  it("writes lengths in hours and minutes, German as Std. and Min.", () => {
    expect(de.duration(5280)).toBe(`1${NBSP}Std.${NBSP}28${NBSP}Min.`);
    expect(gb.duration(5280)).toBe(`1${NBSP}h${NBSP}28${NBSP}min`);
    expect(de.duration(7200)).toBe(`2${NBSP}Std.`);
    expect(de.duration(2700)).toBe(`45${NBSP}Min.`);
    expect(gb.duration(2700)).toBe(`45${NBSP}min`);
    expect(de.duration(30)).toBe(`30${NBSP}Sek.`);
    expect(de.duration(89)).toBe(`1${NBSP}Min.`);
    expect(de.duration(-5)).toBe(`0${NBSP}Sek.`);
  });

  it("never breaks a length apart", () => {
    for (const seconds of [30, 2700, 5280, 7200]) {
      expect(de.duration(seconds)).not.toMatch(/ /u);
      expect(gb.duration(seconds)).not.toMatch(/ /u);
    }
  });

  it("rounds to the nearest minute, carrying into the hour", () => {
    expect(de.duration(3599)).toBe(`1${NBSP}Std.`);
    expect(de.duration(5310)).toBe(`1${NBSP}Std.${NBSP}29${NBSP}Min.`);
  });

  it("writes playback positions and distance behind live", () => {
    expect(de.clock(1890)).toBe("31:30");
    expect(de.clock(3723)).toBe("1:02:03");
    expect(de.clock(5)).toBe("0:05");
    expect(de.behind(1890)).toBe(`${MINUS}31:30`);
    expect(de.behind(0.4)).toBe("0:00");
  });
});

describe("sizes and bitrates", () => {
  it("writes sizes with the region's decimal mark", () => {
    expect(de.size(6.1e9)).toBe(`6,1${NBSP}GB`);
    expect(gb.size(6.1e9)).toBe(`6.1${NBSP}GB`);
    expect(de.size(7e9)).toBe(`7,0${NBSP}GB`);
    expect(de.size(412e9)).toBe(`412${NBSP}GB`);
    expect(de.size(32.5e9)).toBe(`33${NBSP}GB`);
    expect(de.size(2e12)).toBe(`2,0${NBSP}TB`);
    expect(de.size(999)).toBe(`999${NBSP}B`);
    expect(de.size(9.96e9)).toBe(`10${NBSP}GB`);
  });

  it("writes bitrates without a trailing zero", () => {
    expect(de.bitrate(4e6)).toBe(`4${NBSP}Mbit/s`);
    expect(de.bitrate(2.5e6)).toBe(`2,5${NBSP}Mbit/s`);
    expect(gb.bitrate(800e3)).toBe(`800${NBSP}kbit/s`);
  });
});

describe("numbers, plurals and lists", () => {
  it("groups digits the region's way", () => {
    expect(de.number(12345.5)).toBe("12.345,5");
    expect(gb.number(12345.5)).toBe("12,345.5");
    // ICU versions differ on the Swiss apostrophe (typographic or ASCII).
    expect(createFormatters("de", { region: "CH" }).number(12345)).toMatch(/^12['’]345$/u);
  });

  it("puts the formatted count in place of #", () => {
    const forms = { one: "# Aufnahme", other: "# Aufnahmen" };
    expect(de.plural(1, forms)).toBe("1 Aufnahme");
    expect(de.plural(2000, forms)).toBe("2.000 Aufnahmen");
    expect(de.plural(0, forms)).toBe("0 Aufnahmen");
    expect(de.plural(0, { ...forms, zero: "Keine" })).toBe("Keine");
  });

  it("falls back to other when a form is missing", () => {
    expect(gb.plural(1, { other: "# items" })).toBe("1 items");
  });

  it("joins lists in the language", () => {
    expect(de.list(["Rennen", "NBA"])).toBe("Rennen und NBA");
    expect(gb.list(["Rennen", "NBA", "Darts"])).toBe("Rennen, NBA and Darts");
  });

  it("falls back to the language when the region pairing is unknown", () => {
    expect(createFormatters("de", { region: "US" }).tag).toBe("de");
    expect(createFormatters("en", { region: "DE" }).tag).toBe("en-DE");
    expect(createFormatters("en").tag).toBe("en");
  });
});
