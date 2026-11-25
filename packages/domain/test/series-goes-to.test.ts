import { describe, expect, it } from "vitest";
import type { PathLabels } from "../src/grouping.ts";
import { CollectionId, RuleId } from "../src/ids.ts";
import { goesToView, previewStatus } from "../src/series-editor.ts";

const labels: PathLabels = {
  other: "Other",
  films: "Films",
  season: (season) => `Season ${season}`,
  episode: (episode) => `Episode ${episode}`,
  month: (year, month) => `${year}-${month}`,
  airing: () => "",
  film: (title) => title,
};

const f1 = CollectionId.make("formel-1");
const news = CollectionId.make("news");
const rule = RuleId.make("live-f1");
const collections = [
  { id: f1, name: "Formel 1", follows: { ruleId: rule } },
  { id: news, name: "News" },
];
const everything = { mayRecord: true };
const matches = [
  {},
  {
    group: {
      source: "series" as const,
      folders: [{ _tag: "Text" as const, text: "Tatort" }],
      item: { _tag: "Text" as const, text: "Folge 1" },
    },
  },
];

describe("previewStatus", () => {
  it("waits for a draft it can preview, then loads, fails or shows", () => {
    const read = { blocked: false, data: undefined, failed: false, refreshing: false };
    expect(previewStatus({ ...read, blocked: true }).kind).toBe("waiting");
    expect(previewStatus(read).kind).toBe("loading");
    expect(previewStatus({ ...read, failed: true }).kind).toBe("failed");
    expect(previewStatus({ ...read, data: 1, refreshing: true })).toEqual({
      kind: "ready",
      preview: 1,
      refreshing: true,
    });
  });
});

describe("goesToView", () => {
  const base = {
    ruleId: rule,
    collectionId: undefined,
    collections,
    access: everything,
    mayCreateCollections: true,
    preview: { matches, offer: { groups: 3 } },
    labels,
  };

  it("names where Automatic lands and offers to group what scatters", () => {
    const view = goesToView(base);
    expect(view.automaticName).toBe("Tatort");
    expect(view.offer).toEqual({ groups: 3 });
    expect(view.following?.id).toBe(f1);
    expect(view.chosen).toBeUndefined();
  });

  it("offers nothing once a collection is picked", () => {
    const view = goesToView({ ...base, collectionId: news });
    expect(view.offer).toBeUndefined();
    expect(view.chosen?.name).toBe("News");
  });

  it("lists only what a collection-limited profile may record into, plus the following one", () => {
    const view = goesToView({
      ...base,
      ruleId: undefined,
      access: { mayRecord: true, collectionIds: [news] },
    });
    expect(view.allowed.map((collection) => collection.id)).toEqual([news]);
    expect(
      goesToView({ ...base, access: { mayRecord: true, collectionIds: [news] } }).allowed,
    ).toHaveLength(2);
  });
});
