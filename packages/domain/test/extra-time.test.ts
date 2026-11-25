import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  addOverride,
  channelsWithoutOverride,
  defaultExtraTime,
  describeExtraTime,
  ExtraTimeDefaults,
  extraTimeDefaultsProblems,
  initialExtraTimeDefaults,
  removeOverride,
  setGlobalPadding,
  setOverridePadding,
} from "../src/extra-time.ts";
import { arte, daserste, skyF1 } from "./test-support.ts";

/** The household of SPEC 7.7: 2/10 globally, Sport 5/60, Sky Sport F1 HD 5/60, Film 2/15. */
const defaults: ExtraTimeDefaults = {
  padding: { beforeMinutes: 2, afterMinutes: 10 },
  overrides: [
    { _tag: "Category", category: "Sport", padding: { beforeMinutes: 5, afterMinutes: 60 } },
    { _tag: "Channel", channelId: skyF1, padding: { beforeMinutes: 5, afterMinutes: 60 } },
    { _tag: "Category", category: "Film", padding: { beforeMinutes: 2, afterMinutes: 15 } },
  ],
};

describe("default extra time", () => {
  it("names the channel override when the channel has one, even for a sport programme", () => {
    expect(defaultExtraTime(defaults, { channelIds: [skyF1], categories: ["Sport"] })).toEqual({
      padding: { beforeMinutes: 5, afterMinutes: 60 },
      source: { _tag: "Channel", channelId: skyF1 },
    });
  });

  it("uses a channel override for a new rule that has no category yet", () => {
    // Open issue 1: a new rule on Sky Sport F1 HD has no kind; the channel default still applies.
    expect(defaultExtraTime(defaults, { channelIds: [skyF1], categories: [] }).source).toEqual({
      _tag: "Channel",
      channelId: skyF1,
    });
  });

  it("falls back to a category override, compared case-insensitively", () => {
    expect(defaultExtraTime(defaults, { channelIds: [arte], categories: [" film "] })).toEqual({
      padding: { beforeMinutes: 2, afterMinutes: 15 },
      source: { _tag: "Category", category: "Film" },
    });
  });

  it("takes the first matching category override in list order", () => {
    const result = defaultExtraTime(defaults, { channelIds: [], categories: ["Film", "Sport"] });
    expect(result.source).toEqual({ _tag: "Category", category: "Sport" });
  });

  it("uses the global default when nothing matches", () => {
    expect(defaultExtraTime(defaults, { channelIds: [daserste], categories: ["Krimi"] })).toEqual({
      padding: { beforeMinutes: 2, afterMinutes: 10 },
      source: { _tag: "Global" },
    });
  });

  it("applies a channel override to a multi-channel rule only when every channel agrees", () => {
    const both = defaultExtraTime(defaults, { channelIds: [skyF1, arte], categories: ["Sport"] });
    expect(both.source).toEqual({ _tag: "Category", category: "Sport" });
    const agreeing: ExtraTimeDefaults = {
      ...defaults,
      overrides: [
        ...defaults.overrides,
        { _tag: "Channel", channelId: arte, padding: { beforeMinutes: 5, afterMinutes: 60 } },
      ],
    };
    expect(
      defaultExtraTime(agreeing, { channelIds: [skyF1, arte], categories: [] }).source,
    ).toEqual({ _tag: "Channel", channelId: skyF1 });
  });
});

describe("extra time hint", () => {
  it("shows the default's values when nothing was chosen, so hint and steppers agree", () => {
    const hint = describeExtraTime(defaults, { channelIds: [skyF1], categories: [] });
    expect(hint.padding).toEqual(hint.fallback.padding);
    expect(hint.overridesDefault).toBe(false);
  });

  it("marks a rule's own values that differ from the default", () => {
    const own = { beforeMinutes: 2, afterMinutes: 10 };
    const hint = describeExtraTime(defaults, { channelIds: [skyF1], categories: [] }, own);
    expect(hint.padding).toEqual(own);
    expect(hint.overridesDefault).toBe(true);
    expect(hint.fallback.padding).toEqual({ beforeMinutes: 5, afterMinutes: 60 });
  });

  it("does not call equal values an override", () => {
    const hint = describeExtraTime(
      defaults,
      { channelIds: [skyF1], categories: [] },
      { beforeMinutes: 5, afterMinutes: 60 },
    );
    expect(hint.overridesDefault).toBe(false);
  });
});

describe("extra time defaults", () => {
  it("ships with 2 minutes early and 10 after", () => {
    expect(initialExtraTimeDefaults.padding).toEqual({ beforeMinutes: 2, afterMinutes: 10 });
  });

  it("reports duplicate channel and category overrides by index", () => {
    expect(extraTimeDefaultsProblems(defaults)).toEqual([]);
    const duplicated: ExtraTimeDefaults = {
      ...defaults,
      overrides: [
        ...defaults.overrides,
        { _tag: "Category", category: "sport", padding: { beforeMinutes: 1, afterMinutes: 1 } },
        { _tag: "Channel", channelId: skyF1, padding: { beforeMinutes: 1, afterMinutes: 1 } },
      ],
    };
    expect(extraTimeDefaultsProblems(duplicated)).toEqual([
      { _tag: "DuplicateCategory", index: 3, category: "sport" },
      { _tag: "DuplicateChannel", index: 4, channelId: skyF1 },
    ]);
  });

  it("round-trips through its wire schema", () => {
    const encoded = Schema.encodeSync(ExtraTimeDefaults)(defaults);
    expect(Schema.decodeUnknownSync(ExtraTimeDefaults)(encoded)).toEqual(defaults);
    expect(() =>
      Schema.decodeUnknownSync(ExtraTimeDefaults)({
        padding: { beforeMinutes: -1, afterMinutes: 0 },
        overrides: [],
      }),
    ).toThrow(/beforeMinutes/);
  });
});

describe("recording defaults form", () => {
  it("replaces the global padding and leaves the exceptions", () => {
    const next = setGlobalPadding(defaults, { beforeMinutes: 3, afterMinutes: 20 });
    expect(next.padding).toEqual({ beforeMinutes: 3, afterMinutes: 20 });
    expect(next.overrides).toBe(defaults.overrides);
  });

  it("refuses a second override for the same category, whatever its case", () => {
    const result = addOverride(defaults, {
      _tag: "Category",
      category: "sport",
      padding: defaults.padding,
    });
    expect(result).toBe("duplicate");
  });

  it("adds a new category at the end and removes by position", () => {
    const added = addOverride(defaults, {
      _tag: "Category",
      category: "News",
      padding: { beforeMinutes: 2, afterMinutes: 15 },
    });
    if (added === "duplicate") throw new Error("expected an added override");
    expect(added.overrides.map((o) => o._tag)).toEqual([
      "Category",
      "Channel",
      "Category",
      "Category",
    ]);
    expect(removeOverride(added, 0).overrides).toHaveLength(3);
  });

  it("changes one override's minutes and leaves the others", () => {
    const next = setOverridePadding(defaults, 1, { beforeMinutes: 3, afterMinutes: 30 });
    expect(next.overrides[1]?.padding).toEqual({ beforeMinutes: 3, afterMinutes: 30 });
    expect(next.overrides[0]).toBe(defaults.overrides[0]);
  });

  it("offers only channels without an override", () => {
    const free = channelsWithoutOverride(defaults, [{ id: skyF1 }, { id: arte }]);
    expect(free.map((channel) => channel.id)).toEqual([arte]);
  });
});
