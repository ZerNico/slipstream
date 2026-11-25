import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ChannelId, CollectionId, RuleId, UserId } from "../src/ids.ts";
import type { Rule } from "../src/rule.ts";
import {
  collectionNameFor,
  draftCategories,
  draftFromRule,
  draftProblems,
  newCondition,
  newDraft,
  toRuleInput,
  toRuleUpdate,
} from "../src/series-editor.ts";
import { paddingLimits } from "../src/time.ts";

/** The F1 series recording of the web's mock household. */
const f1: Rule = {
  id: RuleId.make("formel-1-live"),
  name: "Formel 1 live",
  enabled: true,
  ownerId: UserId.make("alex"),
  matcher: {
    channels: [ChannelId.make("sky-sport-f1-hd")],
    title: [
      { _tag: "StartsWith", values: ["Live F1:"] },
      { _tag: "Contains", values: ["Qualifying", "Rennen"] },
    ],
    categories: [],
    weekdays: [],
  },
  padding: { beforeMinutes: 5, afterMinutes: 60 },
  retention: { _tag: "KeepNewestEvents", count: 3 },
  collectionId: CollectionId.make("formel-1"),
  createdAt: DateTime.makeUnsafe(Date.UTC(2026, 9, 2)),
  skipRepeats: true,
  offerDeclined: false,
};
const fallback = { beforeMinutes: 2, afterMinutes: 10 };

describe("series recording drafts", () => {
  it("round-trips a saved rule without losing anything", () => {
    const { id: _id, ownerId: _owner, createdAt: _created, offerDeclined: _offer, ...input } = f1;
    expect(toRuleInput(draftFromRule(f1), fallback)).toEqual(input);
  });

  it("starts on only episodes you don't have yet, and keeps a saved choice", () => {
    expect(newDraft().skipRepeats).toBe(true);
    expect(toRuleInput({ ...newDraft(), name: "x" }, fallback).skipRepeats).toBe(true);
    const every = { ...f1, skipRepeats: false };
    expect(draftFromRule(every).skipRepeats).toBe(false);
    expect(toRuleInput(draftFromRule(every), fallback).skipRepeats).toBe(false);
  });

  it("sends the episode choice in a PATCH only when it changed", () => {
    const initial = draftFromRule(f1);
    const renamed = toRuleUpdate({ ...initial, name: "Renamed" }, initial, fallback);
    expect(renamed.name).toBe("Renamed");
    expect("skipRepeats" in renamed).toBe(false);
    const every = toRuleUpdate({ ...initial, skipRepeats: false }, initial, fallback);
    expect(every.skipRepeats).toBe(false);
    // Automatic is an explicit null: an absent key would keep the old collection.
    expect(toRuleUpdate({ ...initial, collectionId: undefined }, initial, fallback)).toMatchObject({
      collectionId: null,
    });
  });

  it("keeps categories as a condition row, and what the editor does not show", () => {
    const rule = {
      ...f1,
      matcher: { ...f1.matcher, categories: ["Sport"], minDurationMinutes: 30 },
      exportTemplate: "{collection}/{title}",
    };
    const draft = { ...draftFromRule(rule), name: "Renamed" };
    expect(draft.conditions.at(-1)).toMatchObject({ kind: "Category", values: ["Sport"] });
    const input = toRuleInput(draft, fallback);
    expect(input.name).toBe("Renamed");
    expect(input.matcher.categories).toEqual(["Sport"]);
    expect(input.matcher.minDurationMinutes).toBe(30);
    expect(input.exportTemplate).toBe("{collection}/{title}");
  });

  it("drops empty conditions and trims words", () => {
    const draft = {
      ...newDraft(),
      name: "Tatort",
      conditions: [
        { key: 1, kind: "IsExactly" as const, values: ["  Tatort ", ""], pattern: "" },
        { key: 2, kind: "Contains" as const, values: [], pattern: "" },
        { key: 3, kind: "Regex" as const, values: [], pattern: "  " },
        { key: 4, kind: "Category" as const, values: [" Krimi ", "Krimi"], pattern: "" },
      ],
    };
    const input = toRuleInput(draft, fallback);
    expect(input.matcher.title).toEqual([{ _tag: "IsExactly", values: ["Tatort"] }]);
    expect(input.matcher.categories).toEqual(["Krimi"]);
    expect(draftCategories(draft)).toEqual(["Krimi"]);
  });

  it("follows the default extra time until the rule has its own", () => {
    const draft = { ...newDraft(), name: "x" };
    expect(toRuleInput(draft, { beforeMinutes: 5, afterMinutes: 60 }).padding).toEqual({
      beforeMinutes: 5,
      afterMinutes: 60,
    });
    const own = { ...draft, padding: { beforeMinutes: 4.6, afterMinutes: 99_999 } };
    // Held inside the steppers' bounds, the one maximum every client uses.
    expect(toRuleInput(own, fallback).padding).toEqual({
      beforeMinutes: 5,
      afterMinutes: paddingLimits.max,
    });
    expect(draftFromRule(f1).padding).toEqual(f1.padding);
  });

  it("maps keep to retention", () => {
    const input = toRuleInput(
      { ...newDraft(), name: "x", keep: "KeepNewestEvents", keepCount: 0 },
      fallback,
    );
    expect(input.retention).toEqual({ _tag: "KeepNewestEvents", count: 1 });
  });

  it("seeds a new rule from a programme or a template", () => {
    const draft = newDraft({ title: "Tatort", channel: ChannelId.make("das-erste") });
    expect(toRuleInput(draft, fallback).matcher).toMatchObject({
      channels: ["das-erste"],
      title: [{ _tag: "StartsWith", values: ["Tatort"] }],
    });
    expect(draftProblems(draft)).toEqual([]);
    const sport = newDraft({ categories: ["Sport"] });
    expect(sport.conditions.map((condition) => condition.kind)).toEqual(["Category"]);
    expect(toRuleInput({ ...sport, name: "Sport" }, fallback).matcher.categories).toEqual([
      "Sport",
    ]);
  });

  it("names a new collection after the title start, never after the automatic group", () => {
    expect(collectionNameFor(draftFromRule(f1))).toBe("Live F1");
    expect(collectionNameFor({ ...newDraft(), name: "Der Pate" })).toBe("Der Pate");
  });

  it("refuses a nameless rule, one that would record everything, and broken patterns", () => {
    const empty = { ...newDraft(), conditions: [] };
    expect(draftProblems(empty)).toEqual([
      { field: "name", kind: "missing" },
      { field: "matcher", kind: "everything" },
    ]);
    const broken = {
      ...newDraft({ title: "x" }),
      conditions: [{ key: 4, kind: "Regex" as const, values: [], pattern: "(unclosed" }],
    };
    expect(draftProblems(broken)).toContainEqual({
      field: "condition",
      kind: "regex",
      index: 0,
      pattern: "(unclosed",
    });
  });
});

describe("condition rows", () => {
  it("keys the rows a draft starts with in order, and a new row after the highest", () => {
    const draft = draftFromRule(f1);
    expect(draft.conditions.map((condition) => condition.key)).toEqual(
      draft.conditions.map((_, index) => index + 1),
    );
    const [, ...rest] = draft.conditions;
    expect(newCondition(rest, "Contains")).toEqual({
      key: draft.conditions.length + 1,
      kind: "Contains",
      values: [],
      pattern: "",
    });
    expect(newCondition([], "Regex").key).toBe(1);
  });
});
