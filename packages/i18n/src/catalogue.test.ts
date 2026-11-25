import { describe, expect, it } from "vitest";
import { type Message, render } from "./catalogue.ts";
import { createFormatters } from "./format.ts";
import { type Locale, locales } from "./locales.ts";
import { catalogues, messagesFor } from "./runtime.ts";
import { areas, sameInGerman, samples } from "../messages/index.ts";
import { glossary } from "../messages/glossary.ts";
import { kitchenSink } from "../messages/kitchen-sink.ts";

const start = new Date("2026-11-22T04:00:00Z");
const end = new Date("2026-11-22T06:00:00Z");

/** A set of messages in every language, with its samples and its deliberate twins. */
interface Source {
  readonly catalogues: Readonly<Record<Locale, Readonly<Record<string, Message>>>>;
  readonly samples: object;
  /** Keys whose German text is the same as the English on purpose. */
  readonly sameInGerman: readonly string[];
}

/** The catalogue, and the kitchen sink's words kept apart from it. */
const sources: Readonly<Record<string, Source>> = {
  catalogue: { catalogues, samples, sameInGerman },
  "kitchen sink": {
    catalogues: { en: kitchenSink.en, de: kitchenSink.de },
    samples: kitchenSink.samples,
    sameInGerman: kitchenSink.sameInGerman,
  },
};

describe.each(Object.entries(sources))("%s", (_, source) => {
  const keys = Object.keys(source.catalogues.en);
  const paramsFor = (key: string): unknown => (source.samples as Record<string, unknown>)[key];
  const sameInGermanKeys = new Set(source.sameInGerman);
  const renderAll = (locale: Locale) => {
    const f = createFormatters(locale, { region: "DE", timeZone: "Europe/Berlin" });
    return keys.map(
      (key) => [key, render(source.catalogues[locale][key] ?? "", paramsFor(key), f)] as const,
    );
  };

  it("has every key in every locale, and nothing extra", () => {
    for (const locale of locales) {
      expect(Object.keys(source.catalogues[locale]).toSorted()).toEqual(keys.toSorted());
    }
  });

  it("keeps each message's kind (text or function) in every locale", () => {
    const mismatched = locales.flatMap((locale) =>
      keys
        .filter((key) => typeof source.catalogues[locale][key] !== typeof source.catalogues.en[key])
        .map((key) => `${locale}.${key}`),
    );
    expect(mismatched).toEqual([]);
  });

  it("has a sample for every message that takes parameters", () => {
    const withParams = keys.filter((key) => typeof source.catalogues.en[key] === "function");
    expect(Object.keys(source.samples).toSorted()).toEqual(withParams.toSorted());
  });

  it.each(locales)("renders every %s message to finished text", (locale) => {
    // Leftover placeholders, missing values, stray whitespace, and the long dash the style
    // guide rules out (built from its code point so this file does not contain one).
    const leftovers = new RegExp(`undefined|NaN|\\[object|[{}#${String.fromCodePoint(0x2014)}]`);
    const unfinished = renderAll(locale)
      .filter(([, text]) => text.length === 0 || text.trim() !== text || leftovers.test(text))
      .map(([key, text]) => `${key}: ${text}`);
    expect(unfinished).toEqual([]);
  });

  it("translates every message into German", () => {
    const english = new Map(renderAll("en"));
    const untranslated = renderAll("de")
      .filter(([key, text]) => text === english.get(key) && !sameInGermanKeys.has(key))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it("uses German quotation marks in German", () => {
    const straightQuotes = renderAll("de")
      .filter(([, text]) => text.includes('"'))
      .map(([key]) => key);
    expect(straightQuotes).toEqual([]);
  });

  it("says each glossary term the glossary's way in German", () => {
    const german = new Map(renderAll("de"));
    const offTerm = renderAll("en").flatMap(([key, text]) => {
      const term = glossary.find((entry) => entry.en === text);
      return term && german.get(key) !== term.de ? [`${key}: ${german.get(key)}`] : [];
    });
    expect(offTerm).toEqual([]);
  });

  it("uses none of the German variants the glossary avoids", () => {
    const avoided = glossary.flatMap((term) => term.avoid ?? []);
    const offGlossary = renderAll("de")
      .filter(([, text]) => avoided.some((word) => text.includes(word)))
      .map(([key, text]) => `${key}: ${text}`);
    expect(offGlossary).toEqual([]);
  });
});

describe("areas", () => {
  it("never define the same key twice, so no area silently overrides another", () => {
    const owners = new Map<string, string[]>();
    const groups = Object.entries(areas).map(([name, area]) => [name, area.en] as const);
    for (const [name, messages] of groups) {
      for (const key of Object.keys(messages)) owners.set(key, [...(owners.get(key) ?? []), name]);
    }
    const twice = [...owners].filter(([, names]) => names.length > 1);
    expect(twice).toEqual([]);
  });

  it("only lists their own keys as the same in German", () => {
    for (const area of Object.values(areas)) {
      for (const key of area.sameInGerman) expect(Object.keys(area.en)).toContain(key);
    }
  });
});

describe("messages with parameters", () => {
  const en = messagesFor("en", { region: "GB", timeZone: "Europe/Berlin" });
  const de = messagesFor("de", { region: "DE", timeZone: "Europe/Berlin" });

  it("pluralises per language, with an exact zero where given", () => {
    expect(en.recordings_count({ count: 0 })).toBe("No recordings");
    expect(en.recordings_count({ count: 1 })).toBe("1 recording");
    expect(en.recordings_count({ count: 1234 })).toBe("1,234 recordings");
    expect(de.recordings_count({ count: 0 })).toBe("Keine Aufnahmen");
    expect(de.recordings_count({ count: 1 })).toBe("1 Aufnahme");
    expect(de.recordings_count({ count: 1234 })).toBe("1.234 Aufnahmen");
    expect(en.nav_issues({ count: 1 })).toBe("1 issue");
    expect(de.nav_issues({ count: 6 })).toBe("6 Probleme");
  });

  it("formats dates, sizes and durations inside sentences", () => {
    const nbsp = String.fromCodePoint(0xa0);
    expect(de.recordings_slot({ start, end })).toBe("So., 22. Nov. · 05:00–07:00");
    expect(en.recordings_time_left({ seconds: 5280 })).toBe(`1${nbsp}h${nbsp}28${nbsp}min left`);
    expect(de.recordings_time_left({ seconds: 5280 })).toContain(
      `1${nbsp}Std.${nbsp}28${nbsp}Min.`,
    );
    expect(de.storage_meter({ usedBytes: 412e9, totalBytes: 2e12, bufferBytes: 6.1e9 })).toBe(
      `Aufnahmen belegen 412${nbsp}GB von 2,0${nbsp}TB. Pausieren und Zurückspulen belegt 6,1${nbsp}GB.`,
    );
    expect(en.player_behind_live({ seconds: 1890 })).toBe(
      `${String.fromCodePoint(0x2212)}31:30 behind live`,
    );
  });

  it("takes no parameters for plain text", () => {
    expect(en.nav_recordings()).toBe("Recordings");
    expect(de.nav_recordings()).toBe("Aufnahmen");
  });
});
