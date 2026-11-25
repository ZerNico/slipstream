import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  compileRegex,
  hasRepeatMarker,
  isOnlyRepeatMarker,
  matchTitleCondition,
  regexHazard,
  seriesDisplayName,
  type TitleCondition,
  withoutRepeatMarkers,
} from "../src/title.ts";

describe("broadcast noise in titles", () => {
  it("reads repeat markers in any case, bracketed or bare", () => {
    for (const title of ["Tatort (Wh.)", "Tatort (wdh)", "Tatort - Wiederholung", "Tatort Wdh."]) {
      expect(hasRepeatMarker(title)).toBe(true);
    }
    expect(hasRepeatMarker("Tatort: Borowski")).toBe(false);
    expect(isOnlyRepeatMarker(" (Wdh.) ")).toBe(true);
    expect(isOnlyRepeatMarker("Wdh. vom Sonntag")).toBe(false);
  });

  it("takes repeat markers out of a poster line", () => {
    expect(withoutRepeatMarkers("Rennen (Wh.)")).toBe("Rennen");
    expect(withoutRepeatMarkers("Tatort (WDH) Borowski")).toBe("Tatort Borowski");
  });

  it("cleans a leading Live and trailing markers, keeping Live as a word of the title", () => {
    expect(cleanTitle("Live F1: Rennen (Wh.)")).toBe("F1: Rennen");
    expect(cleanTitle("LIVE - Bundesliga (live)")).toBe("Bundesliga");
    expect(cleanTitle("Live and Let Die")).toBe("Live and Let Die");
  });
});

describe("seriesDisplayName", () => {
  it("trims trailing separators and whitespace", () => {
    expect(seriesDisplayName("Live F1:")).toBe("Live F1");
    expect(seriesDisplayName("  Live F1 :  ")).toBe("Live F1");
    expect(seriesDisplayName("Tatort -")).toBe("Tatort");
    expect(seriesDisplayName("Sportschau |")).toBe("Sportschau");
    expect(seriesDisplayName("Tatort")).toBe("Tatort");
  });

  it("keeps what belongs to the name", () => {
    expect(seriesDisplayName("Wetten, dass..?")).toBe("Wetten, dass..?");
    expect(seriesDisplayName("Der Pate (1972)")).toBe("Der Pate (1972)");
    expect(seriesDisplayName("Polizeiruf 110")).toBe("Polizeiruf 110");
  });

  it("never answers empty for a title of separators only", () => {
    expect(seriesDisplayName(" : ")).toBe(":");
  });
});

describe("regex safety", () => {
  it("lets the patterns rules use through", () => {
    const patterns = [
      "^(?<series>.+?): (?<episode>.+)$",
      "^(?:Live )?F1: (?<session>.+) - (?<event>GP .+)$",
      "(Qualifying|Rennen)+",
      "Folge \\d+",
      "[A-Z]{2,4}\\.? ?\\d{1,3}",
      "\\(\\d+\\)",
    ];
    expect(patterns.filter((pattern) => regexHazard(pattern) !== undefined)).toEqual([]);
  });

  it("refuses what could backtrack without end", () => {
    expect(regexHazard("^(.+)+X$")).toBe("nestedQuantifier");
    expect(regexHazard("(a*)*")).toBe("nestedQuantifier");
    expect(regexHazard("((ab)+c)+")).toBe("nestedQuantifier");
    expect(regexHazard("(x{2,})*")).toBe("nestedQuantifier");
    expect(regexHazard("(a|.)*")).toBe("overlappingAlternation");
    expect(regexHazard("(a|ab)+$")).toBe("overlappingAlternation");
    expect(regexHazard("(\\d|\\w)+")).toBe("overlappingAlternation");
    expect(regexHazard("(a)\\1")).toBe("backreference");
    expect(regexHazard("(?<x>a)\\k<x>")).toBe("backreference");
    expect(regexHazard(".*.*.*.*x")).toBe("tooManyQuantifiers");
    expect(regexHazard("a".repeat(201))).toBe("tooLong");
  });

  it("compiles each pattern once and never an unsafe one", () => {
    expect(compileRegex("^(.+)+X$", false)).toBeUndefined();
    expect(compileRegex("^F1", false)).toBe(compileRegex("^F1", false));
    expect(compileRegex("^F1", true)).not.toBe(compileRegex("^F1", false));
  });

  it("an unsafe pattern never matches, however long the title", () => {
    const started = performance.now();
    expect(
      matchTitleCondition({ _tag: "Regex", pattern: "^(.+)+X$" }, { title: "a".repeat(10_000) }),
    ).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(100);
  });
});

const match = (condition: TitleCondition, title: string, subtitle?: string) =>
  matchTitleCondition(condition, { title, subtitle });

describe("title conditions", () => {
  it("starts with: the longest prefix wins", () => {
    const condition: TitleCondition = { _tag: "StartsWith", values: ["F1:", "Live F1:"] };
    expect(match(condition, "Live F1: Rennen - GP Las Vegas")).toMatchObject({
      value: "Live F1:",
      text: "Live F1:",
      index: 0,
    });
    expect(match(condition, "F1: Pressekonferenz Qualifying - GP Las Vegas")?.value).toBe("F1:");
    expect(match(condition, "Formel 1: Analyse")).toBeUndefined();
  });

  it("is case-insensitive unless asked otherwise and keeps the original casing", () => {
    expect(match({ _tag: "StartsWith", values: ["live f1:"] }, "LIVE F1: Rennen")?.text).toBe(
      "LIVE F1:",
    );
    expect(
      match({ _tag: "StartsWith", values: ["live f1:"], caseSensitive: true }, "LIVE F1: Rennen"),
    ).toBeUndefined();
  });

  it("contains one of: prefers the longest word, then the earliest", () => {
    const sessions: TitleCondition = {
      _tag: "Contains",
      values: ["Qualifying", "Sprint Qualifying", "Sprint", "Rennen"],
    };
    expect(match(sessions, "Live F1: Sprint Qualifying - GP Katar")?.text).toBe(
      "Sprint Qualifying",
    );
    expect(match(sessions, "Live F1: Sprint - GP Katar")?.text).toBe("Sprint");
    expect(match(sessions, "Live F1: Freies Training - GP Katar")).toBeUndefined();
  });

  it("is exactly: compares the whole normalised title", () => {
    const tagesschau: TitleCondition = { _tag: "IsExactly", values: ["Tagesschau"] };
    expect(match(tagesschau, "  Tagesschau ")).toBeDefined();
    expect(match(tagesschau, "Tagesschau (Wh.)")).toBeUndefined();
  });

  it("collapses whitespace in titles and values", () => {
    expect(
      match({ _tag: "Contains", values: ["Freies  Training"] }, "Live F1:  1. Freies   Training"),
    ).toMatchObject({ text: "Freies Training", index: 12 });
  });

  it("can look at the sub-title instead", () => {
    const condition: TitleCondition = {
      _tag: "Contains",
      values: ["Schattenmann"],
      field: "subtitle",
    };
    expect(match(condition, "Tatort", "Schattenmann")?.field).toBe("subtitle");
    expect(match(condition, "Tatort: Schattenmann")).toBeUndefined();
  });

  it("regex: reports named groups and rejects invalid patterns", () => {
    const condition: TitleCondition = {
      _tag: "Regex",
      pattern: "^(?:Live )?F1: (?<session>.+) - (?<event>GP .+)$",
    };
    expect(match(condition, "Live F1: Rennen - GP Las Vegas")?.groups).toEqual({
      session: "Rennen",
      event: "GP Las Vegas",
    });
    expect(match({ _tag: "Regex", pattern: "(" }, "anything")).toBeUndefined();
  });
});
