import { Schema } from "effect";
import { type Collection, CollectionLayout, defaultLayout, whatConditions } from "./collection.ts";
import { type GroupingContext, groupRecording, type GroupSubject } from "./grouping.ts";
import { cleanTitle } from "./title.ts";
import type { Matcher } from "./matcher.ts";
import { seriesMatcher, seriesPrefix } from "./series-rule.ts";
import { inferLayout, titleStart } from "./suggestions.ts";
import { normaliseText } from "./title.ts";
import type { ChannelId } from "./ids.ts";
import { epochMs } from "./time.ts";

/*
 * The collection offer (recording model §3.3): when a series recording's programmes would
 * scatter in the library, Slipstream offers to group them in a collection that follows it.
 */

/** "Group these as “Live F1”?": the prefilled name, the layout, and how scattered it is. */
export const CollectionOffer = Schema.Struct({
  /** Prefilled from `seriesPrefix(title).name` ("Live F1"). */
  name: Schema.NonEmptyString,
  layout: CollectionLayout,
  /** How many places in Recordings the programmes show up in today. */
  groups: Schema.Int.check(Schema.isGreaterThanOrEqualTo(2)),
  /** A few different titles, earliest first. */
  examples: Schema.Array(Schema.String),
}).annotate({ identifier: "CollectionOffer" });
export type CollectionOffer = typeof CollectionOffer.Type;

/** What the offer check needs besides the programmes. */
export interface CollectionOfferContext extends GroupingContext {
  /** The household's collections: programmes some collection already holds group there. */
  readonly collections?: ReadonlyArray<Collection> | undefined;
}

/** How many example titles an offer carries. */
const examplesMax = 3;

/** Whether `title` is `name` or starts with it followed by a word break ("Nachrichten am Abend"). */
const startsWithName = (title: string, name: string): boolean => {
  const lower = normaliseText(title).toLowerCase();
  const wanted = name.toLowerCase();
  return (
    lower === wanted ||
    (lower.startsWith(wanted) && !/[\p{L}\p{N}]/u.test(lower[wanted.length] ?? ""))
  );
};

/**
 * The name the series recording's titles share: the shortest `seriesPrefix` name every title
 * starts with ("Nachrichten" for "Nachrichten" and "Nachrichten am Abend", never the one that
 * happens to air first). `undefined` when no such name exists.
 */
const offerName = (titles: ReadonlyArray<string>): string | undefined =>
  titles
    .map((title) => seriesPrefix(title).name)
    .filter((name) => name !== "" && titles.every((title) => startsWithName(title, name)))
    .toSorted((a, b) => a.length - b.length)[0];

/**
 * Whether a series recording's programmes scatter (§3.3): its recordings plus its planned
 * matches fall into at least two different places in Recordings, at least one of them grouped
 * by title and date. Places are counted by show, not by month, so Tagesschau (one title) and
 * Tatort (episode data, one show) never get it; "Live F1: Qualifying - GP Katar" and "Live F1:
 * Rennen - GP Katar" do. Returns the offer, or `undefined`. Whether to show it at all (no
 * collection yet, not declined, allowed to create collections) is the caller's check.
 */
export const collectionOffer = (
  items: ReadonlyArray<GroupSubject>,
  context: CollectionOfferContext,
): CollectionOffer | undefined => {
  const places = new Map<string, boolean>();
  for (const item of items) {
    const { path } = groupRecording(item, context.collections ?? [], context);
    const [folder] = path.folders;
    const key =
      path.source === "collection"
        ? `collection:${path.collectionId ?? ""}`
        : path.source === "film"
          ? "film"
          : `show:${folder?._tag === "Text" ? folder.text.toLowerCase() : ""}`;
    places.set(key, (places.get(key) ?? false) || path.source === "title");
  }
  if (places.size < 2 || ![...places.values()].some(Boolean)) return undefined;
  const ordered = items.toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
  const [first] = ordered;
  if (first === undefined) return undefined;
  const name = offerName(ordered.map((item) => item.title)) ?? cleanTitle(first.title);
  if (name === "") return undefined;
  const titles = [...new Set(ordered.map((item) => normaliseText(item.title)))];
  return {
    name,
    layout: inferLayout(titles.map((title) => titleStart(title)?.rest ?? cleanTitle(title))),
    groups: places.size,
    examples: titles.slice(0, examplesMax),
  };
};

/**
 * The conditions and layout of a collection made from one programme ("New collection…" in the
 * programme sheet and the editor's Goes to): the *what* conditions "Record every…" would use
 * (this channel, or any without one; titles starting with the prefix) and the default layout.
 */
export const seriesCollection = (programme: {
  readonly channelId?: ChannelId | undefined;
  readonly title: string;
}): { readonly matcher: Matcher; readonly layout: CollectionLayout } => ({
  matcher: whatConditions(seriesMatcher(programme)),
  layout: defaultLayout,
});
