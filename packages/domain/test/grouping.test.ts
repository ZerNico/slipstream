import { describe, expect, it } from "vitest";
import {
  exportPath,
  groupRecording,
  renderPath,
  renderTemplate,
  safeFileName,
  seasonLabel,
} from "../src/grouping.ts";
import { CollectionId, RuleId } from "../src/ids.ts";
import { cleanTitle } from "../src/title.ts";
import { extractPart, partFromSelection, prepareTitle, type TitlePart } from "../src/parts.ts";
import {
  arte,
  at,
  collection,
  daserste,
  eurosport,
  germanLabels,
  prosieben,
  skyBundesliga,
  skyF1,
  subject,
  timeZone,
} from "./test-support.ts";
import { matchTitleCondition, type TitleCondition } from "../src/title.ts";

const dash = "–";

const formel1 = collection("formel-1", "Formel 1", {
  matcher: { title: [{ _tag: "StartsWith", values: ["F1:", "Live F1:"] }] },
  layout: {
    parts: [
      { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
      { _tag: "Split", name: "programme", before: { separator: " - ", occurrence: "last" } },
    ],
    path: ["{year}", "{event}", "{programme}"],
  },
});

const bundesliga = collection("bundesliga", "Bundesliga", {
  matcher: { title: [{ _tag: "Contains", values: ["Bundesliga"] }] },
  layout: {
    parts: [
      {
        _tag: "Split",
        name: "matchday",
        after: { separator: ", ", occurrence: "first" },
        before: { separator: ": ", occurrence: "first" },
      },
      { _tag: "Split", name: "match", after: { separator: ": ", occurrence: "last" } },
    ],
    path: ["{season}", "{matchday}", "{match}"],
    seasonStartMonth: 8,
  },
});

const snooker = collection("snooker", "Snooker", {
  matcher: { title: [{ _tag: "StartsWith", values: ["Snooker:"] }] },
  layout: {
    parts: [
      {
        _tag: "Split",
        name: "tournament",
        before: { separator: ` ${dash} `, occurrence: "first" },
      },
      { _tag: "Split", name: "round", after: { separator: ` ${dash} `, occurrence: "last" } },
    ],
    path: ["{tournament}", "{round}"],
  },
});

const collections = [formel1, bundesliga, snooker];

const group = (fields: Parameters<typeof subject>[0], ruleCollectionId?: CollectionId) => {
  const grouping = groupRecording(subject(fields), collections, { timeZone, ruleCollectionId });
  return { ...grouping, rendered: renderPath(grouping.path, germanLabels).join(" › ") };
};

describe("grouping: the design doc examples", () => {
  it("Formel 1 race recorded by the rule", () => {
    const result = group(
      {
        channelId: skyF1,
        title: "Live F1: Rennen - GP Las Vegas",
        start: at("2026-11-22T04:00:00Z"),
        end: at("2026-11-22T06:00:00Z"),
        ruleId: RuleId.make("f1"),
      },
      formel1.id,
    );
    expect(result.rendered).toBe("Formel 1 › 2026 › GP Las Vegas › Rennen");
    expect(result.path.source).toBe("collection");
    expect(result.placement?.reason).toBe("rule");
  });

  it("press conference recorded by hand lands next to the race", () => {
    const result = group({
      channelId: skyF1,
      title: "F1: Pressekonferenz Qualifying - GP Las Vegas",
      start: at("2026-11-21T05:30:00Z"),
      end: at("2026-11-21T06:00:00Z"),
    });
    expect(result.rendered).toBe("Formel 1 › 2026 › GP Las Vegas › Pressekonferenz Qualifying");
    expect(result.placement?.reason).toBe("only");
  });

  it("Bundesliga with a season starting in August", () => {
    const result = group({
      channelId: skyBundesliga,
      title: `Live: Bundesliga, 12. Spieltag: FC Bayern ${dash} Borussia Dortmund`,
      start: at("2026-11-21T14:30:00Z"),
      end: at("2026-11-21T16:30:00Z"),
    });
    expect(result.rendered).toBe(
      `Bundesliga › 2026/27 › 12. Spieltag › FC Bayern ${dash} Borussia Dortmund`,
    );
  });

  it("a title the collection matches but cannot split goes to Other", () => {
    const result = group({
      channelId: skyF1,
      title: "Live F1: Saisonrückblick 2026",
      start: at("2026-12-20T19:00:00Z"),
      end: at("2026-12-20T20:00:00Z"),
    });
    expect(result.rendered).toBe("Formel 1 › Other › Saisonrückblick 2026");
    expect(result.path.folders[1]).toEqual({ _tag: "Other" });
  });

  it("Snooker splits on the en dash", () => {
    const result = group({
      channelId: eurosport,
      title: `Snooker: UK Championship ${dash} Finale`,
      start: at("2026-12-06T19:00:00Z"),
      end: at("2026-12-06T22:00:00Z"),
    });
    expect(result.rendered).toBe("Snooker › UK Championship › Finale");
  });

  it("series data from the guide: The Big Bang Theory", () => {
    const result = group({
      channelId: prosieben,
      title: "The Big Bang Theory",
      subtitle: "Die Stockholm-Erkenntnis",
      episode: { season: 12, episode: 24 },
      start: at("2026-11-21T04:20:00Z"),
      end: at("2026-11-21T04:40:00Z"),
    });
    expect(result.path.source).toBe("series");
    expect(result.rendered).toBe(
      "The Big Bang Theory › Staffel 12 › Folge 24 · Die Stockholm-Erkenntnis",
    );
  });

  it("guide sub-title without season numbers: Tatort", () => {
    const result = group({
      channelId: daserste,
      title: "Tatort",
      subtitle: "Schattenmann",
      start: at("2026-11-22T19:15:00Z"),
      end: at("2026-11-22T20:45:00Z"),
    });
    expect(result.path.source).toBe("subtitle");
    expect(result.rendered).toBe("Tatort › 2026 › Schattenmann");
  });

  it("fallback by cleaned title and date: Tagesschau (Wh.)", () => {
    const result = group({
      channelId: daserste,
      title: "Tagesschau (Wh.)",
      start: at("2026-11-21T19:00:00Z"),
      end: at("2026-11-21T19:15:00Z"),
      repeat: true,
    });
    expect(result.path.source).toBe("title");
    expect(result.rendered).toBe("Tagesschau › November 2026 › Sa 21. Nov, 20:00");
  });

  it("film fallback: Der Pate", () => {
    const result = group({
      channelId: arte,
      title: "Der Pate",
      categories: ["Spielfilm"],
      originalAirDate: { year: 1972 },
      start: at("2026-11-22T19:15:00Z"),
      end: at("2026-11-22T22:05:00Z"),
    });
    expect(result.path.source).toBe("film");
    expect(result.rendered).toBe("Films › Der Pate (1972)");
  });
});

describe("grouping details", () => {
  it("cleans broadcast noise from titles", () => {
    expect(cleanTitle("Tagesschau (Wh.)")).toBe("Tagesschau");
    expect(cleanTitle("Polizeiruf 110 (Wdh.)")).toBe("Polizeiruf 110");
    expect(cleanTitle("Live: Bundesliga")).toBe("Bundesliga");
    expect(cleanTitle("LIVE Handball-WM (Live)")).toBe("Handball-WM");
    expect(cleanTitle("Biathlon - Live")).toBe("Biathlon");
    expect(cleanTitle("Live is Life")).toBe("Live is Life");
    expect(cleanTitle("Live")).toBe("Live");
  });

  it("names sports seasons by their start month", () => {
    expect(seasonLabel({ year: 2026, month: 11 }, 8)).toBe("2026/27");
    expect(seasonLabel({ year: 2027, month: 3 }, 8)).toBe("2026/27");
    expect(seasonLabel({ year: 2026, month: 8 }, 8)).toBe("2026/27");
    expect(seasonLabel({ year: 2099, month: 9 }, 8)).toBe("2099/00");
    expect(seasonLabel({ year: 2026, month: 3 }, undefined)).toBe("2026");
  });

  it("uses the original air date for the season of a repeat", () => {
    const result = group({
      channelId: skyBundesliga,
      title: `Bundesliga, 34. Spieltag: FC Bayern ${dash} VfB Stuttgart`,
      repeat: true,
      originalAirDate: { year: 2026, month: 5, day: 16 },
      start: at("2026-11-21T10:00:00Z"),
      end: at("2026-11-21T12:00:00Z"),
    });
    expect(result.rendered).toBe(
      `Bundesliga › 2025/26 › 34. Spieltag › FC Bayern ${dash} VfB Stuttgart`,
    );
  });

  it("an empty layout lists the items flat under the collection", () => {
    const kids = collection("kids", "Kids", { matcher: { channels: [arte] } });
    const grouping = groupRecording(
      subject({
        channelId: arte,
        title: "Karambolage",
        start: at("2026-11-22T18:00:00Z"),
        end: at("2026-11-22T18:15:00Z"),
      }),
      [kids],
      { timeZone },
    );
    expect(renderPath(grouping.path, germanLabels)).toEqual(["Kids", "Karambolage"]);
  });

  it("fills built-in variables and refuses missing ones", () => {
    expect(renderTemplate("{show} ({year})", { show: "Tatort", year: "2026" })).toBe(
      "Tatort (2026)",
    );
    expect(renderTemplate("{subtitle}", {})).toBeUndefined();
    expect(renderTemplate("  ", {})).toBeUndefined();
  });

  it("builds safe export paths from the same group path", () => {
    const grouping = groupRecording(
      subject({
        channelId: skyBundesliga,
        title: `Live: Bundesliga, 12. Spieltag: FC Bayern ${dash} Borussia Dortmund`,
        start: at("2026-11-21T14:30:00Z"),
        end: at("2026-11-21T16:30:00Z"),
      }),
      collections,
      { timeZone },
    );
    expect(exportPath(grouping.path, germanLabels, "mkv")).toBe(
      `Bundesliga/2026-27/12. Spieltag/FC Bayern ${dash} Borussia Dortmund.mkv`,
    );
    expect(safeFileName('Tatort: "Wer?" / Teil 1...')).toBe("Tatort - -Wer-- - Teil 1");
  });
});

describe("title parts", () => {
  const prefix: TitleCondition = { _tag: "StartsWith", values: ["F1:", "Live F1:"] };
  const prepare = (title: string, conditions: ReadonlyArray<TitleCondition> = [prefix]) =>
    prepareTitle(
      title,
      conditions.flatMap((condition) => matchTitleCondition(condition, { title }) ?? []),
    );

  it("skips the matched prefix and the punctuation after it", () => {
    const withoutColon: TitleCondition = { _tag: "StartsWith", values: ["Live F1"] };
    const prepared = prepare("Live F1: Rennen - GP Las Vegas", [withoutColon]);
    expect(prepared.title.slice(prepared.contentStart)).toBe("Rennen - GP Las Vegas");
  });

  it("extracts the matched word of a contains-one-of condition", () => {
    const sessions: TitleCondition = { _tag: "Contains", values: ["Qualifying", "Rennen"] };
    const prepared = prepare("Live F1: Rennen - GP Las Vegas", [prefix, sessions]);
    expect(extractPart({ _tag: "Matched", name: "session" }, prepared)).toBe("Rennen");
    expect(extractPart({ _tag: "Matched", name: "session" }, prepare("Live F1: Rennen"))).toBe(
      undefined,
    );
  });

  it("returns nothing for a missing separator or an empty part", () => {
    const event: TitlePart = {
      _tag: "Split",
      name: "event",
      after: { separator: " - ", occurrence: "last" },
    };
    expect(extractPart(event, prepare("Live F1: Saisonrückblick 2026"))).toBeUndefined();
    expect(extractPart(event, prepare("Live F1: Rennen - "))).toBeUndefined();
  });

  it("turns a selection in an example title into a part", () => {
    const title = `Live: Bundesliga, 12. Spieltag: FC Bayern ${dash} Borussia Dortmund`;
    const prepared = prepare(title, [{ _tag: "Contains", values: ["Bundesliga"] }]);
    const select = (text: string) => {
      const start = title.indexOf(text);
      return { start, end: start + text.length };
    };
    expect(partFromSelection("matchday", prepared, select("12. Spieltag"))).toEqual({
      _tag: "Split",
      name: "matchday",
      after: { separator: ", ", occurrence: "first" },
      before: { separator: ": ", occurrence: "first" },
    });
    expect(
      partFromSelection("match", prepared, select(`FC Bayern ${dash} Borussia Dortmund`)),
    ).toEqual({
      _tag: "Split",
      name: "match",
      after: { separator: ": ", occurrence: "last" },
    });
    // Not bordered by separators on the left.
    expect(partFromSelection("x", prepared, select("Spieltag"))).toBeUndefined();
  });

  it("selections reproduce on other titles of the same collection", () => {
    const example = prepare("Live F1: Rennen - GP Las Vegas");
    const start = example.title.indexOf("GP Las Vegas");
    const part = partFromSelection("event", example, { start, end: example.title.length });
    expect(part).toEqual({
      _tag: "Split",
      name: "event",
      after: { separator: " - ", occurrence: "first" },
    });
    expect(extractPart(part!, prepare("F1: Pressekonferenz Qualifying - GP Katar"))).toBe(
      "GP Katar",
    );
    const programme = partFromSelection("programme", example, { start: 9, end: 15 });
    expect(programme).toEqual({
      _tag: "Split",
      name: "programme",
      before: { separator: " - ", occurrence: "first" },
    });
  });

  it("exposes named regex groups as parts", () => {
    const regexCollection = collection("rx", "Formel 1", {
      matcher: {
        title: [{ _tag: "Regex", pattern: "^(?:Live )?F1: (?<session>.+) - (?<event>GP .+)$" }],
      },
      layout: { parts: [], path: ["{event}", "{session}"] },
    });
    const grouping = groupRecording(
      subject({
        channelId: skyF1,
        title: "Live F1: Sprint - GP Katar",
        start: at("2026-11-28T14:00:00Z"),
        end: at("2026-11-28T15:00:00Z"),
      }),
      [regexCollection],
      { timeZone },
    );
    expect(renderPath(grouping.path, germanLabels)).toEqual(["Formel 1", "GP Katar", "Sprint"]);
  });
});
