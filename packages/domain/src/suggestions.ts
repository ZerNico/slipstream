import { Schema } from "effect";
import {
  type Collection,
  CollectionLayout,
  type CollectionSubject,
  defaultLayout,
  placeInCollection,
} from "./collection.ts";
import { ChannelId, CollectionId, type RuleId } from "./ids.ts";
import { emptyMatcher, evaluateMatcher, Matcher, type MatchSubject } from "./matcher.ts";
import { type Anchor, defaultSeparators, type TitlePart } from "./parts.ts";
import { leadingLive, normaliseText, type TitleCondition } from "./title.ts";
import { durationMillis, epochMs, localParts, MINUTE, Weekday } from "./time.ts";

/*
 * Helpers that grow collections from what is already recorded (PLAN 6.6): suggestions when
 * several recordings share a channel and a title start, and "also move similar ones" when a
 * recording is moved by hand.
 */

/** The shared beginning of a title, e.g. "Live F1:" in "Live F1: Rennen - GP Las Vegas". */
export interface TitleStart {
  /** The start as written, including a leading "Live", for a "starts with" condition. */
  readonly prefix: string;
  /** The start without "Live" and the trailing colon: "F1". Names a suggested collection. */
  readonly name: string;
  /** Case-folded `name`; titles with the same key share a start. */
  readonly key: string;
  /** The title after the start and its separator: "Rennen - GP Las Vegas". */
  readonly rest: string;
}

/**
 * Finds a title's start: the text up to the first separator (" - ", " – ", ": ", ", "), after an
 * optional leading "Live". A colon stays part of the start ("F1:"), the others do not.
 * Returns `undefined` when the title has no separator to split on.
 */
export const titleStart = (title: string): TitleStart | undefined => {
  const normalised = normaliseText(title);
  const live = leadingLive.exec(normalised)?.[0] ?? "";
  const body = normalised.slice(live.length);
  let found: { readonly index: number; readonly separator: string } | undefined;
  for (const separator of defaultSeparators) {
    const index = body.indexOf(separator);
    if (index > 0 && (found === undefined || index < found.index)) found = { index, separator };
  }
  if (found === undefined) return undefined;
  const name = body.slice(0, found.index).trim();
  const head = found.separator.trim() === ":" ? `${name}:` : name;
  return {
    prefix: `${live}${head}`,
    name,
    key: name.toLowerCase(),
    rest: body.slice(found.index + found.separator.length).trim(),
  };
};

/** How many different values there are, ignoring case and outer spaces. */
const distinctCount = (values: ReadonlyArray<string>): number =>
  new Set(values.map((value) => value.trim().toLowerCase())).size;

/**
 * Layout for a group of title rests ("Rennen - GP Katar"): event and programme split at the
 * separator most of them share, else the year and the programme.
 */
export const inferLayout = (rests: ReadonlyArray<string>): CollectionLayout => {
  const counts = defaultSeparators.map((separator) => ({
    separator,
    count: rests.filter((rest) => rest.includes(separator)).length,
  }));
  const best = counts.toSorted((a, b) => b.count - a.count)[0];
  if (best === undefined || best.count * 2 < rests.length) {
    return defaultLayout;
  }
  const anchor: Anchor = { separator: best.separator, occurrence: "last" };
  const split = rests.filter((rest) => rest.includes(best.separator));
  const before = distinctCount(
    split.map((rest) => rest.slice(0, rest.lastIndexOf(best.separator))),
  );
  const after = distinctCount(
    split.map((rest) => rest.slice(rest.lastIndexOf(best.separator) + best.separator.length)),
  );
  // The side that repeats across recordings is the event ("GP Las Vegas" holds several sessions).
  const eventFirst = before < after;
  const part = (name: string, leading: boolean): TitlePart =>
    leading ? { _tag: "Split", name, before: anchor } : { _tag: "Split", name, after: anchor };
  return {
    parts: [part("event", eventFirst), part("programme", !eventFirst)],
    path: ["{year}", "{event}", "{programme}"],
  };
};

/** One way a matcher was widened, for "also move similar ones" ("adds 'F1:' to the title"). */
export const MatcherChange = Schema.TaggedUnion({
  AddChannel: { channelId: ChannelId },
  /** A value added to the title condition at `index` in `matcher.title`. */
  AddTitleValue: { index: Schema.Int, value: Schema.String },
  AddCategory: { category: Schema.String },
  AddWeekday: { weekday: Weekday },
  WidenDuration: {
    minDurationMinutes: Schema.optionalKey(Schema.Int),
    maxDurationMinutes: Schema.optionalKey(Schema.Int),
  },
}).annotate({ identifier: "MatcherChange" });
export type MatcherChange = typeof MatcherChange.Type;

/**
 * The result of widening a matcher to also take a recording. `CannotExtend`: a regex condition
 * failed (only the expert editor can change it), or the recording lacks what a condition reads
 * (no sub-title, no category).
 */
export const MatcherExtension = Schema.TaggedUnion({
  Extended: { matcher: Matcher, changes: Schema.Array(MatcherChange) },
  AlreadyMatches: {},
  CannotExtend: { reason: Schema.Literals(["regex", "noSubtitle", "noCategory"]) },
}).annotate({ identifier: "MatcherExtension" });
export type MatcherExtension = typeof MatcherExtension.Type;

const contentWord = (text: string): string => {
  const rest = titleStart(text)?.rest ?? normaliseText(text);
  const cut = defaultSeparators
    .map((separator) => rest.indexOf(separator))
    .filter((index) => index > 0)
    .toSorted((a, b) => a - b)[0];
  return (cut === undefined ? rest : rest.slice(0, cut)).trim();
};

/** The value a failed title condition gets so it holds for `text` and similar titles. */
const valueFor = (condition: TitleCondition, text: string): string => {
  switch (condition._tag) {
    case "StartsWith":
      return titleStart(text)?.prefix ?? normaliseText(text);
    case "Contains":
      return contentWord(text) || normaliseText(text);
    case "IsExactly":
    case "Regex":
      return normaliseText(text);
  }
};

/**
 * Widens a matcher just enough to also match `subject`, criterion by criterion: adds its channel,
 * adds a title value to each failing title condition (its title start for "starts with", the
 * word after the start for "contains", the whole title for "is exactly"), adds its category and
 * weekday, and stretches the duration range. Criteria the subject already meets stay as they are.
 */
export const extendMatcher = (
  matcher: Matcher,
  subject: MatchSubject,
  timeZone: string,
): MatcherExtension => {
  if (evaluateMatcher(matcher, subject, timeZone) !== undefined) return { _tag: "AlreadyMatches" };
  const changes: Array<MatcherChange> = [];

  let channels = matcher.channels;
  if (channels.length > 0 && !channels.includes(subject.channelId)) {
    channels = [...channels, subject.channelId];
    changes.push({ _tag: "AddChannel", channelId: subject.channelId });
  }

  const title: Array<TitleCondition> = [];
  for (const [index, condition] of matcher.title.entries()) {
    if (evaluateMatcher({ ...emptyMatcher, title: [condition] }, subject, timeZone)) {
      title.push(condition);
      continue;
    }
    if (condition._tag === "Regex") return { _tag: "CannotExtend", reason: "regex" };
    const text = (condition.field ?? "title") === "title" ? subject.title : subject.subtitle;
    if (text === undefined || normaliseText(text) === "") {
      return { _tag: "CannotExtend", reason: "noSubtitle" };
    }
    const value = valueFor(condition, text);
    title.push({ ...condition, values: [...condition.values, value] });
    changes.push({ _tag: "AddTitleValue", index, value });
  }

  let categories = matcher.categories;
  if (categories.length > 0) {
    const wanted = new Set(categories.map((category) => category.toLowerCase()));
    if (!subject.categories.some((category) => wanted.has(category.toLowerCase()))) {
      const [category] = subject.categories;
      if (category === undefined) return { _tag: "CannotExtend", reason: "noCategory" };
      categories = [...categories, category];
      changes.push({ _tag: "AddCategory", category });
    }
  }

  let weekdays = matcher.weekdays;
  const { weekday } = localParts(subject.start, timeZone);
  if (weekdays.length > 0 && !weekdays.includes(weekday)) {
    weekdays = [...weekdays, weekday];
    changes.push({ _tag: "AddWeekday", weekday });
  }

  const minutes = durationMillis(subject) / MINUTE;
  const widened: { minDurationMinutes?: number; maxDurationMinutes?: number } = {};
  if (matcher.minDurationMinutes !== undefined && minutes < matcher.minDurationMinutes) {
    widened.minDurationMinutes = Math.floor(minutes);
  }
  if (matcher.maxDurationMinutes !== undefined && minutes > matcher.maxDurationMinutes) {
    widened.maxDurationMinutes = Math.ceil(minutes);
  }
  if (Object.keys(widened).length > 0) changes.push({ _tag: "WidenDuration", ...widened });

  return {
    _tag: "Extended",
    matcher: { ...matcher, channels, title, categories, weekdays, ...widened },
    changes,
  };
};

/** A recording or upcoming programme whose collection would change. */
export interface AffectedSubject<S> {
  readonly subject: S;
  /** Where it sits today; absent when it is in no collection. */
  readonly from?: CollectionId | undefined;
}

/** Past and future recordings a matcher change would move into the collection. */
export interface MatcherChangePreview<S> {
  readonly past: ReadonlyArray<AffectedSubject<S>>;
  readonly future: ReadonlyArray<AffectedSubject<S>>;
}

/**
 * Previews "also move similar ones": which of `subjects` (recordings and upcoming programmes)
 * would land in the collection once its matcher is `matcher`, that are elsewhere today. Split
 * at `now` (epoch ms) into past and future by start time.
 */
export const previewMatcherChange = <S extends CollectionSubject>(
  collections: ReadonlyArray<Collection>,
  collectionId: CollectionId,
  matcher: Matcher,
  subjects: ReadonlyArray<S>,
  options: {
    readonly timeZone: string;
    readonly now: number;
    /** The collection a rule points to, for the rule step of the precedence. */
    readonly ruleCollection?: ((ruleId: RuleId) => CollectionId | undefined) | undefined;
  },
): MatcherChangePreview<S> => {
  const after = collections.map((collection) =>
    collection.id === collectionId ? { ...collection, matcher } : collection,
  );
  const past: Array<AffectedSubject<S>> = [];
  const future: Array<AffectedSubject<S>> = [];
  for (const subject of subjects) {
    const context = {
      timeZone: options.timeZone,
      ruleCollectionId:
        subject.ruleId === undefined ? undefined : options.ruleCollection?.(subject.ruleId),
    };
    const was = placeInCollection(collections, subject, context)?.collection.id;
    const becomes = placeInCollection(after, subject, context)?.collection.id;
    if (was === collectionId || becomes !== collectionId) continue;
    const entry: AffectedSubject<S> = was === undefined ? { subject } : { subject, from: was };
    (epochMs(subject.start) < options.now ? past : future).push(entry);
  }
  return { past, future };
};
