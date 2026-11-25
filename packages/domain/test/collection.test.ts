import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  collectionOverlaps,
  explainPlacement,
  PlacementExplanation,
  layoutProblems,
  matchCollection,
  placeInCollection,
  templateVariables,
} from "../src/collection.ts";
import {
  linkProblems,
  matcherEquals,
  resolveCollections,
  type StoredCollection,
  whatConditions,
} from "../src/collection.ts";
import { collectionOffer, seriesCollection } from "../src/collection-offer.ts";
import { CollectionId } from "../src/ids.ts";
import { emptyMatcher, type Matcher } from "../src/matcher.ts";
import { seriesRule } from "../src/series-rule.ts";
import { at, collection, daserste, rule, skyF1, subject, timeZone } from "./test-support.ts";

const titleOnly = collection("f1-title", "Formel 1", {
  matcher: { title: [{ _tag: "StartsWith", values: ["F1:"] }] },
});
const longerPrefix = collection("f1-live", "Formel 1 live", {
  matcher: { title: [{ _tag: "StartsWith", values: ["Live F1:"] }] },
});
const channelAndTitle = collection("sky-f1", "Sky F1", {
  matcher: { channels: [skyF1], title: [{ _tag: "StartsWith", values: ["F1:", "Live F1:"] }] },
});
const labelled = collection("motorsport", "Motorsport", {
  labels: ["Motorsport"],
  rank: -10,
});

const press = subject({
  channelId: skyF1,
  title: "F1: Pressekonferenz Qualifying - GP Las Vegas",
  start: at("2026-11-21T05:30:00Z"),
  end: at("2026-11-21T06:00:00Z"),
});
const liveRace = { ...press, title: "Live F1: Rennen - GP Las Vegas" };

describe("collection matching", () => {
  it("matches by label even when the matcher is empty, and never by an empty matcher", () => {
    expect(matchCollection(labelled, press, timeZone)).toBeUndefined();
    expect(
      matchCollection(labelled, { ...press, labels: ["Motorsport"] }, timeZone)?.criteria,
    ).toEqual([{ _tag: "Label", label: "Motorsport" }]);
  });

  it("explains a match by its criteria", () => {
    const match = matchCollection(titleOnly, press, timeZone);
    expect(match?.criteria).toMatchObject([
      { _tag: "Title", hit: { condition: "StartsWith", value: "F1:" } },
    ]);
  });
});

describe("collection precedence", () => {
  const all = [titleOnly, longerPrefix, channelAndTitle, labelled];

  it("pinned by hand beats everything, even without a match", () => {
    const placement = placeInCollection(
      all,
      { ...press, pinnedCollectionId: labelled.id },
      { timeZone, ruleCollectionId: titleOnly.id },
    );
    expect(placement?.collection.id).toBe(labelled.id);
    expect(placement?.reason).toBe("pinned");
    expect(placement?.match).toBeUndefined();
    expect(placement?.alsoMatched).toEqual([titleOnly.id, channelAndTitle.id]);
  });

  it("the rule's collection beats a more specific matcher", () => {
    const placement = placeInCollection(all, press, { timeZone, ruleCollectionId: titleOnly.id });
    expect(placement?.collection.id).toBe(titleOnly.id);
    expect(placement?.reason).toBe("rule");
    expect(placement?.match).toBeDefined();
  });

  it("ignores a pin or rule collection that no longer exists", () => {
    const placement = placeInCollection(
      [titleOnly],
      { ...press, pinnedCollectionId: channelAndTitle.id },
      { timeZone, ruleCollectionId: longerPrefix.id },
    );
    expect(placement?.reason).toBe("only");
  });

  it("channel + title beats title only", () => {
    const placement = placeInCollection([titleOnly, channelAndTitle], press, { timeZone });
    expect(placement?.collection.id).toBe(channelAndTitle.id);
    expect(placement?.reason).toBe("specificity");
  });

  it("a longer prefix beats a shorter one", () => {
    const shortOrLong = collection("f1-any", "F1 any", {
      matcher: { title: [{ _tag: "StartsWith", values: ["F1:", "Live F1:"] }] },
    });
    const placement = placeInCollection([shortOrLong, longerPrefix], liveRace, { timeZone });
    // Both match "Live F1:" here, so the tie goes to ranking.
    expect(placement?.reason).toBe("ranking");
    const short = placeInCollection(
      [titleOnly, longerPrefix],
      { ...liveRace, title: "F1: x" },
      {
        timeZone,
      },
    );
    expect(short?.collection.id).toBe(titleOnly.id);
    const longer = placeInCollection(
      [
        collection("f1-colon", "F1", {
          matcher: { title: [{ _tag: "Contains", values: ["F1:"] }] },
        }),
        longerPrefix,
      ],
      liveRace,
      { timeZone },
    );
    expect(longer?.collection.id).toBe(longerPrefix.id);
    expect(longer?.reason).toBe("specificity");
  });

  it("the user's ranking decides between equally specific collections", () => {
    const first = collection("a", "A", { rank: 2, matcher: { channels: [daserste] } });
    const second = collection("b", "B", { rank: 1, matcher: { channels: [daserste] } });
    const tatort = subject({
      channelId: daserste,
      title: "Tatort",
      start: at("2026-11-22T19:15:00Z"),
      end: at("2026-11-22T20:45:00Z"),
    });
    const placement = placeInCollection([first, second], tatort, { timeZone });
    expect(placement?.collection.id).toBe(second.id);
    expect(placement?.reason).toBe("ranking");
    expect(placement?.alsoMatched).toEqual([first.id]);
  });

  it("explains the placement in wire form", () => {
    const placement = placeInCollection([titleOnly], press, { timeZone });
    expect(explainPlacement(placement!)).toEqual({
      collectionId: titleOnly.id,
      reason: "only",
      criteria: [{ _tag: "Title", condition: "StartsWith", field: "title", value: "F1:" }],
      alsoMatched: [],
    });
    expect(Schema.encodeSync(PlacementExplanation)(explainPlacement(placement!))).toBeDefined();
  });

  it("returns nothing when no collection applies", () => {
    expect(
      placeInCollection(all, { ...press, title: "Tagesschau", channelId: daserste }, { timeZone }),
    ).toBeUndefined();
  });
});

describe("collection editor checks", () => {
  it("warns about overlaps with other collections", () => {
    const tagesschau = { ...press, channelId: daserste, title: "Tagesschau" };
    const overlaps = collectionOverlaps(
      channelAndTitle,
      [titleOnly, longerPrefix, channelAndTitle],
      [press, liveRace, tagesschau],
      timeZone,
    );
    expect(overlaps.map((overlap) => [overlap.collection.id, overlap.shared.length])).toEqual([
      [titleOnly.id, 1],
      [longerPrefix.id, 1],
    ]);
  });

  it("validates layouts", () => {
    expect(templateVariables("{year} - {event}")).toEqual(["year", "event"]);
    expect(
      layoutProblems(
        {
          parts: [
            { _tag: "Split", name: "year" },
            { _tag: "Split", name: "event" },
            { _tag: "Matched", name: "event" },
          ],
          path: ["{season}", "{event}", "{venue}", "{session}"],
        },
        ["session"],
      ),
    ).toEqual([
      { _tag: "ReservedPartName", name: "year" },
      { _tag: "DuplicatePartName", name: "event" },
      { _tag: "UnknownVariable", name: "venue" },
    ]);
  });
});

const stored = (source: StoredCollection["source"], id = "formel-1"): StoredCollection => ({
  id: CollectionId.make(id),
  name: "Formel 1",
  rank: 0,
  labels: [],
  layout: { parts: [], path: [] },
  source,
});

describe("linked collections (§3.4)", () => {
  const liveF1: Matcher = {
    ...emptyMatcher,
    channels: [skyF1],
    title: [{ _tag: "StartsWith", values: ["Live F1:"] }],
    weekdays: ["sat", "sun"],
    minDurationMinutes: 30,
  };
  const series = rule("live-f1", liveF1, {
    name: "Live F1",
    collectionId: CollectionId.make("formel-1"),
  });
  const snapshot: Matcher = { ...emptyMatcher, title: [{ _tag: "StartsWith", values: ["F1:"] }] };
  const linked = stored({ _tag: "FollowsRule", ruleId: series.id, snapshot });

  it("resolves a linked collection to the rule's what conditions and says whom it follows", () => {
    const [resolved] = resolveCollections([linked], [series]);
    expect(resolved?.matcher).toEqual({
      channels: [skyF1],
      title: [{ _tag: "StartsWith", values: ["Live F1:"] }],
      categories: [],
      weekdays: [],
    });
    expect(resolved?.follows).toEqual({ ruleId: series.id, ruleName: "Live F1" });
    // A Saturday press conference recorded by hand still lands in it: no when conditions.
    expect(
      matchCollection(
        resolved!,
        subject({
          channelId: skyF1,
          title: "Live F1: Pressekonferenz",
          start: at("2026-11-25T10:00:00Z"),
          end: at("2026-11-25T10:10:00Z"),
        }),
        timeZone,
      ),
    ).toBeDefined();
  });

  it("keeps an own matcher as it is", () => {
    const [own] = resolveCollections([stored({ _tag: "Own", matcher: snapshot })], [series]);
    expect(own?.matcher).toEqual(snapshot);
    expect(own).not.toHaveProperty("follows");
  });

  it("falls back to the snapshot when the rule is missing, never to an empty matcher", () => {
    expect(resolveCollections([linked], [])[0]?.matcher).toEqual(snapshot);
    const weekdaysOnly = { ...series, matcher: { ...emptyMatcher, weekdays: ["sun" as const] } };
    expect(resolveCollections([linked], [weekdaysOnly])[0]?.matcher).toEqual(snapshot);
  });

  it("checks that a followed rule points back, exists and is followed once", () => {
    expect(linkProblems([linked], [series])).toEqual([]);
    const elsewhere = { ...series, collectionId: CollectionId.make("other") };
    expect(linkProblems([linked], [elsewhere]).map((problem) => problem._tag)).toEqual([
      "NotPointedBack",
    ]);
    expect(linkProblems([linked], []).map((problem) => problem._tag)).toEqual(["MissingRule"]);
    const twice = stored({ _tag: "FollowsRule", ruleId: series.id, snapshot }, "second");
    expect(linkProblems([linked, twice], [series]).map((problem) => problem._tag)).toEqual([
      "FollowedTwice",
      "NotPointedBack",
    ]);
  });

  it("compares what conditions as sets, ignoring case, spacing, weekdays and duration", () => {
    const same: Matcher = {
      ...emptyMatcher,
      channels: [skyF1],
      title: [{ _tag: "StartsWith", values: ["live  f1:", "Live F1:"] }],
    };
    expect(matcherEquals(liveF1, same)).toBe(true);
    expect(matcherEquals(whatConditions(liveF1), liveF1)).toBe(true);
    expect(
      matcherEquals({ ...liveF1, categories: ["Sport"] }, { ...liveF1, categories: ["sport"] }),
    ).toBe(true);
    expect(matcherEquals(liveF1, { ...liveF1, channels: [] })).toBe(false);
    expect(
      matcherEquals(liveF1, {
        ...liveF1,
        title: [{ _tag: "StartsWith", values: ["Live F1:"], caseSensitive: true }],
      }),
    ).toBe(false);
  });

  it("makes a collection from one programme with the series recording's what conditions", () => {
    const programme = { channelId: skyF1, title: "Live F1: Rennen - GP Katar" };
    expect(seriesCollection(programme).matcher).toEqual(
      whatConditions(seriesRule(programme, { beforeMinutes: 0, afterMinutes: 0 }).matcher),
    );
  });
});

const offerItem = (
  title: string,
  day: number,
  fields: Partial<Parameters<typeof subject>[0]> = {},
) =>
  subject({
    channelId: skyF1,
    title,
    start: at(`2026-11-${day}T13:00:00Z`),
    end: at(`2026-11-${day}T14:30:00Z`),
    ...fields,
  });

describe("collection offer (§3.3)", () => {
  it("offers to group a Live F1 weekend that scatters into three places", () => {
    const offer = collectionOffer(
      [
        offerItem("Live F1: 1. Freies Training - GP Katar", 27),
        offerItem("Live F1: Qualifying - GP Katar", 28),
        offerItem("Live F1: Rennen - GP Katar", 29),
      ],
      { timeZone },
    );
    expect(offer).toMatchObject({
      name: "Live F1",
      groups: 3,
      examples: [
        "Live F1: 1. Freies Training - GP Katar",
        "Live F1: Qualifying - GP Katar",
        "Live F1: Rennen - GP Katar",
      ],
    });
    expect(offer?.layout.path).toEqual(["{year}", "{event}", "{programme}"]);
  });

  it("never offers for one show with episode data, or one title by date", () => {
    const tatort = [21, 22, 23].map((day, index) =>
      offerItem("Tatort", day, { channelId: daserste, episode: { episode: 1247 + index } }),
    );
    expect(collectionOffer(tatort, { timeZone })).toBeUndefined();
    const news = [1, 2, 3].map((day) => offerItem("Tagesschau", day + 10, { channelId: daserste }));
    expect(collectionOffer(news, { timeZone })).toBeUndefined();
  });

  it("names the offer after what every title starts with, not the first to air", () => {
    const news = [
      offerItem("Nachrichten am Abend", 21),
      offerItem("Nachrichten", 22),
      offerItem("Nachrichten am Abend", 23),
    ];
    expect(collectionOffer(news, { timeZone })?.name).toBe("Nachrichten");
  });

  it("does not offer when a collection already holds them", () => {
    const formel1 = collection("formel-1", "Formel 1", {
      matcher: { title: [{ _tag: "StartsWith", values: ["Live F1:"] }] },
    });
    const weekend = [
      offerItem("Live F1: Qualifying - GP Katar", 28),
      offerItem("Live F1: Rennen - GP Katar", 29),
    ];
    expect(collectionOffer(weekend, { timeZone })?.groups).toBe(2);
    expect(collectionOffer(weekend, { timeZone, collections: [formel1] })).toBeUndefined();
  });
});
