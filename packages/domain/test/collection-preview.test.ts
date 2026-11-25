import { describe, expect, it } from "vitest";
import {
  offerPreviewPath,
  previewCollection,
  previewSegments,
  type PreviewSubject,
} from "../src/collection-preview.ts";
import type { CollectionLayout } from "../src/collection.ts";
import { type PathSegment, renderSegment } from "../src/grouping.ts";
import { RecordingId } from "../src/ids.ts";
import {
  at,
  collection,
  daserste,
  germanLabels,
  programme,
  skyF1,
  subject,
  timeZone,
} from "./test-support.ts";

const draft = collection("draft", "Formel 1", {
  matcher: { title: [{ _tag: "StartsWith", values: ["F1:", "Live F1:"] }] },
  layout: {
    parts: [
      { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
      { _tag: "Split", name: "session", before: { separator: " - ", occurrence: "last" } },
    ],
    path: ["{event}", "{session}"],
  },
});
const pressCollection = collection("press", "Pressekonferenzen", {
  matcher: { title: [{ _tag: "Contains", values: ["Pressekonferenz"] }] },
});
const motorsport = collection("motorsport", "Motorsport", { labels: ["Motorsport"] });

const recording = (id: string, title: string, fields: Partial<PreviewSubject> = {}) => ({
  ...subject({
    channelId: skyF1,
    title,
    start: at("2026-11-29T16:00:00Z"),
    end: at("2026-11-29T18:00:00Z"),
  }),
  id: RecordingId.make(id),
  ...fields,
});

const race = recording("race", "Live F1: Rennen - GP Abu Dhabi");
const unsplit = recording("magazine", "F1: Das Magazin");
const pinned = recording("press", "F1: Pressekonferenz - GP Abu Dhabi", {
  pinnedCollectionId: pressCollection.id,
});
const byRule = recording("labelled", "F1: Highlights - GP Abu Dhabi", {
  labels: ["Motorsport"],
  ruleCollectionId: motorsport.id,
});
const unrelated = recording("tatort", "Tatort: Borowski");

describe("collection preview", () => {
  const preview = previewCollection(
    draft,
    [pressCollection, motorsport],
    [race, unsplit, pinned, byRule, unrelated],
    { timeZone },
  );

  it("places matching recordings with their path in the draft and where they come from", () => {
    const placed = preview.placed.map((item) => [item.subject.id, item.path, item.from.source]);
    expect(placed).toEqual([
      [
        "race",
        {
          source: "collection",
          collectionId: draft.id,
          folders: [
            { _tag: "Text", text: "Formel 1" },
            { _tag: "Text", text: "GP Abu Dhabi" },
          ],
          item: { _tag: "Text", text: "Rennen" },
        },
        "title",
      ],
      [
        "magazine",
        {
          source: "collection",
          collectionId: draft.id,
          folders: [{ _tag: "Text", text: "Formel 1" }, { _tag: "Other" }],
          item: { _tag: "Text", text: "Das Magazin" },
        },
        "title",
      ],
    ]);
  });

  it("lists what the draft matches but loses to a pin or a rule's collection", () => {
    expect(
      preview.elsewhere.map((item) => [item.subject.id, item.collectionId, item.reason]),
    ).toEqual([
      ["press", pressCollection.id, "pinned"],
      ["labelled", motorsport.id, "rule"],
    ]);
  });

  it("replaces the stored version of the collection being edited", () => {
    const stored = { ...draft, matcher: { ...draft.matcher, title: [] } };
    const edited = previewCollection(draft, [stored, pressCollection], [race], { timeZone });
    expect(edited.placed.map((item) => item.subject.id)).toEqual(["race"]);
    expect(edited.placed[0]?.from.source).toBe("title");
  });
});

const render = (segments: ReadonlyArray<PathSegment>) =>
  segments.map((segment) => renderSegment(segment, germanLabels)).join(" › ");
const text = (value: string): PathSegment => ({ _tag: "Text", text: value });

describe("the collection offer's preview path", () => {
  const byProgramme: CollectionLayout = {
    parts: [{ _tag: "Split", name: "programme" }],
    path: ["{programme}"],
  };
  const news = programme({
    channelId: daserste,
    title: "Nachrichten",
    start: at("2026-11-23T19:00:00Z"),
    end: at("2026-11-23T19:15:00Z"),
  });

  it("never repeats the collection name as the item under Other", () => {
    expect(render(offerPreviewPath("Nachrichten", byProgramme, news, { timeZone }))).toBe(
      "Nachrichten › Other",
    );
  });

  it("keeps an item that differs from the collection name", () => {
    expect(render(offerPreviewPath("Abendnachrichten", byProgramme, news, { timeZone }))).toBe(
      "Abendnachrichten › Other › Nachrichten",
    );
  });

  it("splits what follows the title start, as the series recording will", () => {
    const qatar = programme({
      channelId: skyF1,
      title: "Live F1: Rennen - GP Katar",
      start: at("2026-11-29T16:00:00Z"),
      end: at("2026-11-29T18:00:00Z"),
    });
    const layout: CollectionLayout = {
      parts: [
        { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
        { _tag: "Split", name: "programme", before: { separator: " - ", occurrence: "last" } },
      ],
      path: ["{year}", "{event}", "{programme}"],
    };
    expect(render(offerPreviewPath("Live F1", layout, qatar, { timeZone }))).toBe(
      "Live F1 › 2026 › GP Katar › Rennen",
    );
  });

  it("leaves paths outside a collection alone", () => {
    const path = { source: "title" as const, folders: [text("News")], item: text("News") };
    expect(previewSegments(path)).toHaveLength(2);
  });
});
