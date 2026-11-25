import { afterEach, describe, expect, it } from "vitest";
import { setLocale, setRegion, setTimeZone } from "./runtime.ts";
import { seriesSkipMark, seriesTemplateText } from "./series-text.ts";

afterEach(() => {
  setLocale("en");
  setRegion(undefined);
  setTimeZone(undefined);
});

/** Sunday 22 November 2026, 15:00 in Berlin; Tuesday 24, 20:15. */
const sunday = { day: "sun", date: 22, epochMs: Date.UTC(2026, 10, 22, 14) } as const;
const tuesday = { day: "tue", date: 24, epochMs: Date.UTC(2026, 10, 24, 19, 15) } as const;

describe("series recording words", () => {
  it("names a left-out row's result with the day and time of the copy that counts", () => {
    setRegion("DE");
    setTimeZone("Europe/Berlin");
    expect(seriesSkipMark({ kind: "repeat", state: "recorded", ...sunday })).toEqual({
      kind: "left-out",
      text: "Already recorded · Sun 22, 15:00",
    });
    expect(seriesSkipMark({ kind: "repeat", state: "scheduled", ...tuesday }).text).toBe(
      "Already scheduled · Tue 24, 20:15",
    );
    setLocale("de");
    expect(seriesSkipMark({ kind: "repeat", state: "recorded", ...sunday }).text).toBe(
      "Schon aufgenommen am So 22, 15:00",
    );
    expect(seriesSkipMark({ kind: "repeat", state: "scheduled", ...tuesday }).text).toBe(
      "Schon geplant am Di 24, 20:15",
    );
  });

  it("puts the same airing and a double listing as a note", () => {
    expect(seriesSkipMark({ kind: "same" })).toEqual({
      kind: "note",
      text: "Same airing as a scheduled recording",
    });
    expect(seriesSkipMark({ kind: "duplicate" }).kind).toBe("note");
  });

  it("names every template", () => {
    expect(seriesTemplateText("news").title).toBe("The news, weekdays");
    setLocale("de");
    expect(seriesTemplateText("films").title).toBe("Spielfilme");
  });
});
