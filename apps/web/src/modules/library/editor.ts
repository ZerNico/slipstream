import type { CollectionInput, CollectionUpdate } from "@slipstream/api";
import {
  type ChannelId,
  type Collection,
  CollectionId,
  collectionOverlaps,
  type GroupingContext,
  type PathLabels,
  previewCollection,
  type PreviewSubject,
  renderPath,
  type Retention,
  type TitleCondition,
  type TitlePart,
} from "@slipstream/domain";
import type { LibraryGroup } from "./groups.ts";
import type { Entry } from "./library.ts";

/*
 * The collection editor's draft (SPEC §8.5): what the form edits, how it becomes a collection,
 * and the live preview with the real precedence. Pure, so the preview is tested without a page.
 */

/** Layout levels people can add, in the "+ Part" menu's order. */
export const layoutParts = [
  "year",
  "season",
  "event",
  "programme",
  "subtitle",
  "show",
  "episode",
  "date",
  "title",
] as const;

/** One layout level, as the template variable it renders. */
export type LayoutPart = (typeof layoutParts)[number];

/** Keep choices: a preset, or the collection's own policy when it is none of them. */
export type KeepChoice = "all" | "events3" | "newest10" | "days30" | "current";

/** What the editor form holds. */
export interface CollectionDraft {
  readonly name: string;
  readonly channels: readonly ChannelId[];
  readonly startsWith: readonly string[];
  readonly categories: readonly string[];
  readonly labels: readonly string[];
  readonly path: readonly LayoutPart[];
  readonly keep: KeepChoice;
  /** The stored collection when editing: its id, rank and anything the form doesn't show. */
  readonly base?: Collection | undefined;
}

const keepPolicies: Record<Exclude<KeepChoice, "current">, Retention | undefined> = {
  all: undefined,
  events3: { _tag: "KeepNewestEvents", count: 3 },
  newest10: { _tag: "KeepNewest", count: 10 },
  days30: { _tag: "KeepDays", days: 30 },
};

const keepOf = (retention: Retention | undefined): KeepChoice => {
  if (retention === undefined || retention._tag === "KeepAll") return "all";
  const preset = (Object.keys(keepPolicies) as Exclude<KeepChoice, "current">[]).find(
    (key) => JSON.stringify(keepPolicies[key]) === JSON.stringify(retention),
  );
  return preset ?? "current";
};

const variable = /^\{([a-z]+)\}$/u;

/** The layout path as parts; literal folders the form can't show are dropped. */
const pathParts = (path: readonly string[]): LayoutPart[] =>
  path.flatMap((template) => {
    const name = variable.exec(template)?.[1];
    const part = layoutParts.find((candidate) => candidate === name);
    return part === undefined ? [] : [part];
  });

/** A draft for an existing collection. */
export const draftFromCollection = (collection: Collection): CollectionDraft => ({
  name: collection.name,
  channels: collection.matcher.channels,
  startsWith: collection.matcher.title.flatMap((c) => (c._tag === "StartsWith" ? c.values : [])),
  categories: collection.matcher.categories,
  labels: collection.labels,
  path: pathParts(collection.layout.path),
  keep: keepOf(collection.retention),
  base: collection,
});

/** An empty draft. */
export const emptyDraft: CollectionDraft = {
  name: "",
  channels: [],
  startsWith: [],
  categories: [],
  labels: [],
  path: ["title"],
  keep: "all",
};

/**
 * A draft from an automatic group ("Make it a collection", "New collection from this…"): its
 * name, its channel when every recording shares one, titles that start like the group's name,
 * and episode titles as the layout when the recordings have them.
 */
export const draftFromGroup = (group: LibraryGroup): CollectionDraft => {
  const channels = [...new Set(group.entries.map((entry) => entry.channelId))];
  const prefix = group.entries.every((entry) => entry.title.startsWith(`${group.name}:`))
    ? `${group.name}:`
    : group.name;
  const withSubtitles = group.entries.filter((entry) => entry.subtitle).length;
  return {
    ...emptyDraft,
    name: group.name,
    channels: channels.length === 1 ? channels : [],
    startsWith: group.source === "film" ? [] : [prefix],
    categories: group.source === "film" ? (group.entries[0]?.categories.slice(0, 1) ?? []) : [],
    path: withSubtitles * 2 >= group.entries.length ? ["subtitle"] : ["date"],
  };
};

const splitParts: Record<"event" | "programme", TitlePart> = {
  event: { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
  programme: { _tag: "Split", name: "programme", before: { separator: " - ", occurrence: "last" } },
};

/** The collection a draft saves as. Conditions and parts the form doesn't show are kept. */
export const draftToInput = (draft: CollectionDraft): CollectionInput => {
  const base = draft.base;
  const kept: TitleCondition[] = (base?.matcher.title ?? []).filter((c) => c._tag !== "StartsWith");
  const [first, ...rest] = draft.startsWith;
  const title: TitleCondition[] =
    first === undefined ? kept : [{ _tag: "StartsWith", values: [first, ...rest] }, ...kept];
  const named = new Set((base?.layout.parts ?? []).map((part) => part.name));
  const parts = [
    ...(base?.layout.parts ?? []),
    ...(["event", "programme"] as const).flatMap((name) =>
      draft.path.includes(name) && !named.has(name) ? [splitParts[name]] : [],
    ),
  ];
  const retention =
    draft.keep === "current" ? base?.retention : (keepPolicies[draft.keep] ?? undefined);
  return {
    name: draft.name.trim(),
    rank: base?.rank ?? 0,
    matcher: {
      ...(base?.matcher ?? { weekdays: [] }),
      channels: draft.channels,
      title,
      categories: draft.categories,
    },
    labels: draft.labels,
    layout: {
      ...base?.layout,
      parts,
      path: draft.path.map((part) => `{${part}}`),
    },
    ...(retention === undefined ? {} : { retention }),
  };
};

/**
 * What saving an existing collection sends. A collection that follows a series recording keeps
 * the series recording's conditions, so its matcher is left out (the server refuses one with
 * `followsRule`); everything else is its own.
 */
export const draftToUpdate = (draft: CollectionDraft): CollectionUpdate => {
  const { matcher, ...rest } = draftToInput(draft);
  return draft.base?.follows === undefined ? { ...rest, matcher } : rest;
};

/** Whether the draft says what belongs in it at all (a matcher without criteria matches nothing). */
export const hasCriteria = (draft: CollectionDraft): boolean =>
  draft.startsWith.length > 0 || draft.categories.length > 0 || draft.labels.length > 0;

/**
 * Whether the editor opens with "Advanced: what belongs here" expanded (SPEC §8.5): when the
 * conditions are empty or invalid (a new collection). Otherwise a collection is its name, layout
 * and Keep.
 */
export const opensAdvanced = (draft: CollectionDraft): boolean => !hasCriteria(draft);

/** One node of the preview tree. */
export interface TreeNode {
  readonly name: string;
  readonly other: boolean;
  readonly children: readonly TreeNode[];
  readonly items: readonly { readonly name: string; readonly entry: Entry }[];
}

interface MutableNode {
  name: string;
  other: boolean;
  children: Map<string, MutableNode>;
  items: { name: string; entry: Entry }[];
}

const freeze = (node: MutableNode): TreeNode => ({
  name: node.name,
  other: node.other,
  children: [...node.children.values()].map(freeze),
  items: node.items,
});

/** What the preview shows: the tree, how many land, what can't be split, overlaps. */
export interface DraftPreviewModel {
  readonly tree: readonly TreeNode[];
  readonly placed: number;
  readonly other: number;
  /** Matched, but another collection keeps them (pinned, the rule's collection, more specific). */
  readonly elsewhere: readonly { readonly entry: Entry; readonly collection: string }[];
  readonly overlaps: readonly { readonly name: string; readonly count: number }[];
  /** The first placed recording: the example title of the Layout section. */
  readonly example: { readonly entry: Entry; readonly path: readonly string[] } | undefined;
}

/** The preview before anything belongs in the collection (or before the zone is known). */
export const emptyPreview: DraftPreviewModel = {
  tree: [],
  placed: 0,
  other: 0,
  elsewhere: [],
  overlaps: [],
  example: undefined,
};

/**
 * Previews a draft against the library with the domain's precedence (`previewCollection`), so
 * the tree is exactly what saving would do. Newest first, like the library.
 */
export const previewDraft = (
  draft: CollectionDraft,
  entries: readonly Entry[],
  collections: readonly Collection[],
  ruleCollection: (entry: Entry) => CollectionId | undefined,
  context: GroupingContext,
  labels: PathLabels,
): DraftPreviewModel => {
  if (!hasCriteria(draft) || draft.name.trim() === "") return emptyPreview;
  const input = draftToInput(draft);
  const collection: Collection = { ...input, id: draft.base?.id ?? CollectionId.make("draft") };
  const subjects = entries
    .toSorted((a, b) => b.start.epochMilliseconds - a.start.epochMilliseconds)
    .map((entry): PreviewSubject & { readonly entry: Entry } => ({
      ...entry,
      ruleCollectionId: ruleCollection(entry),
      entry,
    }));
  const preview = previewCollection(collection, collections, subjects, context);
  const root = new Map<string, MutableNode>();
  let other = 0;
  for (const placed of preview.placed) {
    const names = renderPath(placed.path, labels);
    const isOther = placed.path.folders.some((segment) => segment._tag === "Other");
    if (isOther) other += 1;
    let level = root;
    let node: MutableNode | undefined;
    for (const [index, name] of names.slice(0, -1).entries()) {
      node = level.get(name) ?? {
        name,
        other: placed.path.folders[index]?._tag === "Other",
        children: new Map(),
        items: [],
      };
      level.set(name, node);
      level = node.children;
    }
    node?.items.push({ name: names.at(-1) ?? placed.subject.title, entry: placed.subject.entry });
  }
  const first = preview.placed[0];
  return {
    tree: [...root.values()].map(freeze),
    placed: preview.placed.length,
    other,
    elsewhere: preview.elsewhere.map((item) => ({
      entry: item.subject.entry,
      collection: collections.find((c) => c.id === item.collectionId)?.name ?? "",
    })),
    overlaps: collectionOverlaps(collection, collections, subjects, context.timeZone).map(
      (overlap) => ({ name: overlap.collection.name, count: overlap.shared.length }),
    ),
    example:
      first === undefined
        ? undefined
        : { entry: first.subject.entry, path: renderPath(first.path, labels) },
  };
};

/** A piece of an example title: plain, or a part the layout uses (tone 1 event, 2 programme). */
export interface TitlePiece {
  readonly text: string;
  readonly tone: 0 | 1 | 2;
}

/**
 * Marks the parts of an example title that became path levels, so "Live F1: Qualifying - GP
 * Katar" shows "Qualifying" and "GP Katar" in their part colours.
 */
export const markTitle = (
  title: string,
  marks: readonly { readonly text: string; readonly tone: 1 | 2 }[],
): readonly TitlePiece[] => {
  const found = marks
    .flatMap((mark) => {
      const at = mark.text === "" ? -1 : title.lastIndexOf(mark.text);
      return at === -1 ? [] : [{ at, end: at + mark.text.length, tone: mark.tone }];
    })
    .toSorted((a, b) => a.at - b.at);
  const pieces: TitlePiece[] = [];
  let cursor = 0;
  for (const mark of found) {
    if (mark.at < cursor) continue;
    if (mark.at > cursor) pieces.push({ text: title.slice(cursor, mark.at), tone: 0 });
    pieces.push({ text: title.slice(mark.at, mark.end), tone: mark.tone });
    cursor = mark.end;
  }
  if (cursor < title.length) pieces.push({ text: title.slice(cursor), tone: 0 });
  return pieces;
};
