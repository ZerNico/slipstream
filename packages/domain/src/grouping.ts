import { Schema } from "effect";
import {
  type Collection,
  type CollectionPlacement,
  type CollectionSubject,
  placeInCollection,
} from "./collection.ts";
import { isFilmCategory } from "./category.ts";
import { CollectionId } from "./ids.ts";
import { extractParts, prepareTitle, titleContent } from "./parts.ts";
import type { EpisodeInfo, PartialDate } from "./programme.ts";
import { Instant, localParts } from "./time.ts";
import { cleanTitle } from "./title.ts";

/*
 * Group paths are structured, not strings: words such as "Other", "Films" or "Season 12" are
 * rendered by the clients from i18n messages. Only text that comes from titles is plain `Text`.
 */

/** One level of a group path. */
export const PathSegment = Schema.TaggedUnion({
  Text: { text: Schema.String },
  /** "Other": titles a collection matched but its layout could not split. */
  Other: {},
  Films: {},
  Season: { season: Schema.Int },
  Episode: { episode: Schema.Int, subtitle: Schema.optionalKey(Schema.String) },
  Month: { year: Schema.Int, month: Schema.Int },
  /** An item named by its air time, e.g. "Sa 21. Nov, 20:00". */
  Airing: { start: Instant },
  Film: { title: Schema.String, year: Schema.optionalKey(Schema.Int) },
}).annotate({ identifier: "PathSegment" });
export type PathSegment = typeof PathSegment.Type;

/** Which structure the path came from, best first (PLAN 6.6 Grouping). */
export const GroupSource = Schema.Literals(["collection", "series", "subtitle", "film", "title"]);
export type GroupSource = typeof GroupSource.Type;

/** Where a recording appears: folders from the top, then the item itself. */
export const GroupPath = Schema.Struct({
  source: GroupSource,
  collectionId: Schema.optionalKey(CollectionId),
  folders: Schema.Array(PathSegment),
  item: PathSegment,
}).annotate({ identifier: "GroupPath" });
export type GroupPath = typeof GroupPath.Type;

/** What grouping reads from a recording. */
export interface GroupSubject extends CollectionSubject {
  readonly episode?: EpisodeInfo | undefined;
  readonly originalAirDate?: PartialDate | undefined;
  readonly repeat: boolean;
}

/** Household settings grouping depends on. */
export interface GroupingContext {
  readonly timeZone: string;
  /** Channel names for `{channel}`. */
  readonly channelName?: ((channelId: string) => string | undefined) | undefined;
  /** Guide categories that mark a film; compared case-insensitively. */
  readonly filmCategories?: ReadonlyArray<string> | undefined;
}

const text = (value: string): PathSegment => ({ _tag: "Text", text: value });

/**
 * The sports season of a date. Without a start month (or January) it is the year; with August,
 * November 2026 is "2026/27" and March 2027 is still "2026/27".
 */
export const seasonLabel = (
  date: { readonly year: number; readonly month: number },
  startMonth: number | undefined,
): string => {
  if (startMonth === undefined || startMonth <= 1) return String(date.year);
  const first = date.month >= startMonth ? date.year : date.year - 1;
  return `${first}/${String((first + 1) % 100).padStart(2, "0")}`;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const variablesFor = (
  subject: GroupSubject,
  collection: Collection,
  context: GroupingContext,
  parts: Record<string, string>,
): Record<string, string> => {
  const local = localParts(subject.start, context.timeZone);
  const original = subject.originalAirDate;
  const seasonDate =
    subject.repeat && original?.month !== undefined
      ? { year: original.year, month: original.month }
      : local;
  const show = cleanTitle(subject.title);
  const variables: Record<string, string | undefined> = {
    collection: collection.name,
    title: show,
    show,
    season: seasonLabel(seasonDate, collection.layout.seasonStartMonth),
    episode: subject.episode?.episode === undefined ? undefined : String(subject.episode.episode),
    subtitle: subject.subtitle?.trim() === "" ? undefined : subject.subtitle?.trim(),
    year: String(local.year),
    month: pad2(local.month),
    date: `${local.year}-${pad2(local.month)}-${pad2(local.day)}`,
    channel: context.channelName?.(subject.channelId),
  };
  const defined: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (value !== undefined) defined[name] = value;
  }
  return { ...parts, ...defined };
};

/**
 * Fills `{name}` placeholders. Returns `undefined` when a variable has no value or the result is
 * blank, which sends the recording to "Other" instead of a half-filled path.
 */
export const renderTemplate = (
  template: string,
  variables: Readonly<Record<string, string>>,
): string | undefined => {
  let missing = false;
  const rendered = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => {
    const value = variables[name];
    if (value === undefined) missing = true;
    return value ?? "";
  });
  const trimmed = rendered.trim();
  return missing || trimmed === "" ? undefined : trimmed;
};

/** The group path of a recording inside the collection it was placed in. */
export const collectionPath = (
  subject: GroupSubject,
  placement: CollectionPlacement,
  context: GroupingContext,
): GroupPath => {
  const { collection } = placement;
  const prepared = prepareTitle(subject.title, placement.match?.titleHits ?? []);
  const content = titleContent(prepared) || cleanTitle(subject.title);
  const root = text(collection.name);
  const base = { source: "collection" as const, collectionId: collection.id };
  const variables = variablesFor(
    subject,
    collection,
    context,
    extractParts(collection.layout.parts, prepared),
  );
  const rendered = collection.layout.path.map((template) => renderTemplate(template, variables));
  if (rendered.length === 0) return { ...base, folders: [root], item: text(content) };
  const complete = rendered.filter((segment) => segment !== undefined);
  if (complete.length !== rendered.length) {
    return { ...base, folders: [root, { _tag: "Other" }], item: text(content) };
  }
  const item = complete.at(-1) ?? content;
  return { ...base, folders: [root, ...complete.slice(0, -1).map(text)], item: text(item) };
};

/**
 * The group path without a collection: series data from the guide, then films, then a sub-title,
 * then the cleaned title and the month.
 */
export const fallbackPath = (subject: GroupSubject, context: GroupingContext): GroupPath => {
  const show = cleanTitle(subject.title);
  const subtitle = subject.subtitle?.trim() || undefined;
  const local = localParts(subject.start, context.timeZone);
  const { season, episode } = subject.episode ?? {};

  if (episode !== undefined) {
    const item: PathSegment = {
      _tag: "Episode",
      episode,
      ...(subtitle === undefined ? {} : { subtitle }),
    };
    return {
      source: "series",
      folders: season === undefined ? [text(show)] : [text(show), { _tag: "Season", season }],
      item,
    };
  }

  if (subject.categories.some((category) => isFilmCategory(category, context.filmCategories))) {
    const year = subject.originalAirDate?.year;
    return {
      source: "film",
      folders: [{ _tag: "Films" }],
      item: { _tag: "Film", title: show, ...(year === undefined ? {} : { year }) },
    };
  }

  if (subtitle !== undefined && subtitle !== show) {
    return {
      source: "subtitle",
      folders: [text(show), text(String(local.year))],
      item: text(subtitle),
    };
  }

  return {
    source: "title",
    folders: [text(show), { _tag: "Month", year: local.year, month: local.month }],
    item: { _tag: "Airing", start: subject.start },
  };
};

/** Where a recording appears in "Collections & shows", and the collection placement behind it. */
export interface Grouping {
  readonly path: GroupPath;
  readonly placement?: CollectionPlacement | undefined;
}

/**
 * Groups one recording: the winning collection's layout if any collection applies, otherwise the
 * guide-data fallbacks. Works the same for rule, manual and imported recordings.
 */
export const groupRecording = (
  subject: GroupSubject,
  collections: ReadonlyArray<Collection>,
  context: GroupingContext & { readonly ruleCollectionId?: CollectionId | undefined },
): Grouping => {
  const placement = placeInCollection(collections, subject, context);
  return placement === undefined
    ? { path: fallbackPath(subject, context) }
    : { path: collectionPath(subject, placement, context), placement };
};

/** Words for the structured path segments, supplied by the client from its i18n messages. */
export interface PathLabels {
  readonly other: string;
  readonly films: string;
  readonly season: (season: number) => string;
  readonly episode: (episode: number, subtitle: string | undefined) => string;
  readonly month: (year: number, month: number) => string;
  readonly airing: (start: Instant) => string;
  readonly film: (title: string, year: number | undefined) => string;
}

/** Renders one segment with the given labels. */
export const renderSegment = (segment: PathSegment, labels: PathLabels): string => {
  switch (segment._tag) {
    case "Text":
      return segment.text;
    case "Other":
      return labels.other;
    case "Films":
      return labels.films;
    case "Season":
      return labels.season(segment.season);
    case "Episode":
      return labels.episode(segment.episode, segment.subtitle);
    case "Month":
      return labels.month(segment.year, segment.month);
    case "Airing":
      return labels.airing(segment.start);
    case "Film":
      return labels.film(segment.title, segment.year);
  }
};

/** Renders a whole path, folders then item. */
export const renderPath = (path: GroupPath, labels: PathLabels): Array<string> =>
  [...path.folders, path.item].map((segment) => renderSegment(segment, labels));

/**
 * Makes a path segment safe as a file or folder name on Linux, Windows shares and Plex: ": "
 * becomes " - ", other reserved characters become "-", and trailing dots and spaces go.
 */
export const safeFileName = (name: string): string =>
  name
    .replace(/: /gu, " - ")
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what to drop
    .replace(/[\u0000-\u001f]/gu, "")
    .replace(/[/\\:*?"<>|]/gu, "-")
    .replace(/[. ]+$/u, "")
    .trim();

/**
 * The export file path of a recording, relative to the library root: the same group path that
 * the library shows, so the library and the Plex folder always match.
 */
export const exportPath = (path: GroupPath, labels: PathLabels, extension: string): string =>
  `${renderPath(path, labels).map(safeFileName).join("/")}.${extension}`;
