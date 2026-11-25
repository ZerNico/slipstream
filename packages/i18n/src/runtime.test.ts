import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatLocale,
  formatters,
  getLocale,
  getRegion,
  getTimeZone,
  m,
  messagesFor,
  setLocale,
  setRegion,
  setTimeZone,
  subscribe,
} from "./runtime.ts";

afterEach(() => {
  setLocale("en");
  setRegion(undefined);
  setTimeZone(undefined);
});

describe("runtime", () => {
  it("starts in English with no region", () => {
    expect(getLocale()).toBe("en");
    expect(getRegion()).toBeUndefined();
    expect(formatLocale()).toBe("en");
    expect(m.nav_home()).toBe("Home");
  });

  it("switches every message when the language changes", () => {
    setLocale("de");
    expect(m.nav_home()).toBe("Start");
    expect(m.recordings_count({ count: 2 })).toBe("2 Aufnahmen");
    setLocale("en");
    expect(m.recordings_count({ count: 2 })).toBe("2 recordings");
  });

  it("formats with the region in effect", () => {
    setRegion("DE");
    expect(formatLocale()).toBe("en-DE");
    expect(formatters().number(1234.5)).toBe("1.234,5");
    setLocale("de");
    setRegion("CH");
    expect(formatLocale()).toBe("de-CH");
  });

  it("writes clock times and days in the time zone set, not the device's", () => {
    // 23:30 UTC is already the next day in Kiritimati (UTC+14), whatever zone runs the test.
    const at = new Date("2026-11-22T23:30:00Z");
    setRegion("GB");
    expect(getTimeZone()).toBeUndefined();
    setTimeZone("Pacific/Kiritimati");
    expect(getTimeZone()).toBe("Pacific/Kiritimati");
    expect(formatters().time(at)).toBe("13:30");
    expect(formatters().day(at)).toBe("Mon 23 Nov");
    setTimeZone("America/New_York");
    expect(formatters().time(at)).toBe("18:30");
    expect(formatters().day(at)).toBe("Sun 22 Nov");
    setLocale("de");
    expect(formatters().time(at)).toBe("18:30");
    expect(getTimeZone()).toBe("America/New_York");
  });

  it("notifies subscribers on change only, until they unsubscribe", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribe(listener);
    setLocale("de");
    setLocale("de");
    setRegion("AT");
    setTimeZone("Europe/Vienna");
    setTimeZone("Europe/Vienna");
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps fixed-language messages independent of the setting", () => {
    const de = messagesFor("de");
    setLocale("en");
    expect(de.nav_settings()).toBe("Einstellungen");
    expect(m.nav_settings()).toBe("Settings");
  });
});
