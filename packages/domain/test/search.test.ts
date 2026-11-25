import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import type { RecordingState } from "../src/recording.ts";
import {
  filterSearchOptions,
  matchesSearch,
  parseRecentSearches,
  recentSearchLimit,
  rememberSearch,
  searchChannels,
  searchesGuide,
  searchRecordings,
  splitByAiring,
} from "../src/search.ts";

const at = (ms: number) => DateTime.makeUnsafe(ms);

describe("matching", () => {
  it("compares case-insensitively across the fields, never for an empty query", () => {
    expect(matchesSearch("F1", ["Live F1: Qualifying"])).toBe(true);
    expect(matchesSearch("sky 12", ["Sky", "12"])).toBe(true);
    expect(matchesSearch("  ", ["Anything"])).toBe(false);
    expect(matchesSearch("tatort", ["Polizeiruf", undefined])).toBe(false);
  });

  it("asks the guide from two letters on", () => {
    expect(searchesGuide(" f ")).toBe(false);
    expect(searchesGuide("f1")).toBe(true);
  });
});

describe("filterSearchOptions", () => {
  const options = [
    { group: "b" as const, title: "Formel 1 live" },
    { group: "a" as const, title: "Sky Sport F1 HD", meta: "12" },
    { group: "c" as const, title: "Anything", matched: true },
    { group: "b" as const, title: "F1 again" },
  ];

  it("keeps groups in order, caps each, and passes what the server matched", () => {
    const found = filterSearchOptions(options, "f1", ["a", "b", "c"], { perGroup: 1 });
    expect(found.map((option) => option.title)).toEqual([
      "Sky Sport F1 HD",
      "F1 again",
      "Anything",
    ]);
  });

  it("shows only the empty group for an empty query", () => {
    expect(
      filterSearchOptions(options, "", ["a", "b", "c"], { perGroup: 6, whenEmpty: "a" }),
    ).toEqual([options[1]]);
    expect(filterSearchOptions(options, "", ["a", "b", "c"], { perGroup: 6 })).toEqual([]);
  });
});

describe("searchChannels", () => {
  const channels = [
    { name: "Das Erste", number: 1, hidden: false },
    { name: "ZDF", number: 2, hidden: false },
    { name: "ZDFneo", number: 12, hidden: false },
    { name: "3sat ZDF", number: 3, hidden: false },
    { name: "ZDF info", number: 9, hidden: true },
  ];

  it("puts names that start with the query first, then guide order, hidden left out", () => {
    expect(searchChannels(channels, "zdf", 6).map((c) => c.name)).toEqual([
      "ZDF",
      "ZDFneo",
      "3sat ZDF",
    ]);
  });

  it("matches the number too, and caps", () => {
    expect(searchChannels(channels, "12", 6).map((c) => c.name)).toEqual(["ZDFneo"]);
    expect(searchChannels(channels, "zdf", 1)).toHaveLength(1);
  });
});

/** A recording as search reads it. */
const entry = (title: string, state: RecordingState, start: number, subtitle?: string) => ({
  title,
  state,
  start: at(start),
  ...(subtitle === undefined ? {} : { subtitle }),
});

describe("searchRecordings", () => {
  it("shows what can be watched newest first, then the rest, without cancelled ones", () => {
    const found = searchRecordings(
      [
        entry("Tatort", "scheduled", 50),
        entry("Tatort", "completed", 10),
        entry("Krimi", "recording", 30, "Tatort spezial"),
        entry("Tatort", "cancelled", 40),
        entry("Tatort", "failed", 20),
        entry("Polizeiruf", "completed", 60),
      ],
      "tatort",
      10,
    );
    expect(found.map((e) => [e.state, DateTime.toEpochMillis(e.start)])).toEqual([
      ["recording", 30],
      ["completed", 10],
      ["failed", 20],
      ["scheduled", 50],
    ]);
  });
});

describe("splitByAiring", () => {
  it("splits on now and coming up, dropping what ended", () => {
    const programmes = [
      { id: "ended", start: at(0), end: at(10) },
      { id: "now", start: at(10), end: at(30) },
      { id: "later", start: at(30), end: at(40) },
    ];
    const split = splitByAiring(programmes, 20);
    expect(split.onNow.map((p) => p.id)).toEqual(["now"]);
    expect(split.comingUp.map((p) => p.id)).toEqual(["later"]);
  });
});

describe("recent searches", () => {
  it("puts the newest first, once, and keeps a few", () => {
    expect(rememberSearch(["tatort", "F1"], " f1 ")).toEqual(["f1", "tatort"]);
    expect(rememberSearch(["tatort"], "x")).toEqual(["tatort"]);
    const many = Array.from({ length: 20 }, (_, index) => `query ${index}`);
    expect(rememberSearch(many, "new")).toHaveLength(recentSearchLimit);
  });

  it("reads storage defensively", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{")).toEqual([]);
    expect(parseRecentSearches('{"a":1}')).toEqual([]);
    expect(parseRecentSearches('["tatort", 3, ""]')).toEqual(["tatort"]);
  });
});
