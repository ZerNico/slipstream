import { afterEach, describe, expect, it } from "vitest";
import { m, setLocale, setRegion } from "@slipstream/i18n";

afterEach(() => {
  setLocale("en");
  setRegion(undefined);
});

describe("web messages", () => {
  it("follows the language in effect, for every key", () => {
    expect(m.nav_recordings()).toBe("Recordings");
    expect(m.series_new()).toBe("New series recording");
    expect(m.users_remove()).toBe("Delete account");
    setLocale("de");
    expect(m.nav_recordings()).toBe("Aufnahmen");
    expect(m.series_new()).toBe("Neue Serienaufnahme");
    expect(m.users_remove()).toBe("Konto löschen");
  });

  it("formats parameters the region's way", () => {
    setLocale("de");
    setRegion("DE");
    expect(m.nav_issues({ count: 1 })).toBe("1 Problem");
    expect(m.nav_issues({ count: 3 })).toBe("3 Probleme");
    expect(m.quality_medium({ bitsPerSecond: 4e6 })).toBe("Mittel · 4 Mbit/s");
  });

  it("names group path parts in the reader's language", () => {
    expect(m.path_season({ season: 12 })).toBe("Season 12");
    expect(m.path_month({ year: 2026, month: 11 })).toBe("November 2026");
    setLocale("de");
    expect(m.path_episode({ episode: 24, subtitle: "Die Stockholm-Erkenntnis" })).toBe(
      "Folge 24 · Die Stockholm-Erkenntnis",
    );
  });
});
