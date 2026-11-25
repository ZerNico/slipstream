import {
  type AccessPolicy,
  canSeeChannel,
  type GoesToOptions,
  goesToOptions,
} from "./household.ts";
import { type Channel, visibleChannels } from "./channel.ts";
import { seriesCollection } from "./collection-offer.ts";
import { type Collection, defaultLayout } from "./collection.ts";
import { describeExtraTime, type ExtraTimeDefaults, type ExtraTimeHint } from "./extra-time.ts";
import { type GroupPath, type PathLabels, renderSegment } from "./grouping.ts";
import type { ChannelId, CollectionId } from "./ids.ts";
import { emptyMatcher, matcherProblems } from "./matcher.ts";
import type { Retention } from "./recording.ts";
import type { RuleMatchSkip } from "./planner.ts";
import { type RepeatKind, repeatKind } from "./repeats.ts";
import type { Rule, RuleDraft, RuleUpdate } from "./rule.ts";
import {
  compileRegex,
  matchTitleCondition,
  normaliseText,
  seriesDisplayName,
  type TitleCondition,
} from "./title.ts";
import {
  clampPaddingMinutes,
  DAY,
  epochMs,
  HOUR,
  localParts,
  noPadding,
  type Padding,
  type Weekday,
} from "./time.ts";

/*
 * The series recording editor every client shows (SPEC §8.6, recording model §3.2): the draft a
 * person edits, what it saves and previews, what stops it from saving, the templates a new one
 * starts from, and how the preview marks its rows. Pure; the words are in @slipstream/i18n.
 */

/**
 * The kinds of condition the editor offers: the title conditions of the domain, plus "Category
 * is", which the editor shows as a condition row and saves as the matcher's categories.
 */
export type ConditionKind = TitleCondition["_tag"] | "Category";

/** Every condition kind, in the order the editor offers them. */
export const conditionKinds: ReadonlyArray<ConditionKind> = [
  "StartsWith",
  "Contains",
  "IsExactly",
  "Category",
  "Regex",
];

/** One condition as the editor holds it: words for the plain kinds, a pattern for Regex. */
export interface ConditionDraft {
  /** Identifies the row while editing, so removing one keeps the others' input state. */
  readonly key: number;
  readonly kind: ConditionKind;
  readonly values: ReadonlyArray<string>;
  readonly pattern: string;
}

/** A condition row before it has its place in a draft. */
type ConditionFields = Omit<ConditionDraft, "key">;

const blankCondition = (kind: ConditionKind): ConditionFields => ({
  kind,
  values: [],
  pattern: "",
});

/** Rows the domain builds, keyed 1, 2, 3… in order. */
const keyed = (rows: ReadonlyArray<ConditionFields>): Array<ConditionDraft> =>
  rows.map((row, index) => ({ ...row, key: index + 1 }));

/**
 * A new, empty row to add to a draft's conditions, keyed after the highest key there, so the
 * other rows keep theirs.
 */
export const newCondition = (
  conditions: ReadonlyArray<ConditionDraft>,
  kind: ConditionKind,
): ConditionDraft => ({
  key: Math.max(0, ...conditions.map((condition) => condition.key)) + 1,
  ...blankCondition(kind),
});

/** How long recordings are kept, as the editor's two fields. */
export type KeepKind = Retention["_tag"];

/** Every way of keeping recordings, in the order the editor offers them. */
export const keepKinds: ReadonlyArray<KeepKind> = [
  "KeepAll",
  "KeepNewest",
  "KeepNewestEvents",
  "KeepDays",
];

/**
 * A series recording while someone edits it. Everything the editor does not show (duration
 * limits, the export template) rides along from the rule it started from, so saving never drops
 * what another client set.
 *
 * `padding` is the rule's own extra time. `undefined` means "from the defaults": the editor then
 * shows and saves whatever default matches the channels and categories picked right now
 * (SPEC §7.7), so the hint and the steppers can never disagree.
 */
export interface SeriesDraft {
  readonly name: string;
  readonly enabled: boolean;
  readonly channels: ReadonlyArray<ChannelId>;
  readonly conditions: ReadonlyArray<ConditionDraft>;
  readonly weekdays: ReadonlyArray<Weekday>;
  readonly keep: KeepKind;
  readonly keepCount: number;
  readonly padding: Padding | undefined;
  /** "Only episodes you don't have yet" (true, the default) or "Every airing". */
  readonly skipRepeats: boolean;
  readonly collectionId: CollectionId | undefined;
  readonly base: RuleDraft | undefined;
}

const conditionDraft = (condition: TitleCondition): ConditionFields =>
  condition._tag === "Regex"
    ? { ...blankCondition("Regex"), pattern: condition.pattern }
    : { ...blankCondition(condition._tag), values: condition.values };

/** What a new rule starts from: a programme ("Record every …") or a template. */
export interface DraftSeed {
  readonly title?: string | undefined;
  readonly channel?: ChannelId | undefined;
  readonly kind?: ConditionKind | undefined;
  readonly categories?: ReadonlyArray<string> | undefined;
  readonly weekdays?: ReadonlyArray<Weekday> | undefined;
}

/** A blank rule, optionally seeded. Its extra time follows the defaults. */
export const newDraft = (seed: DraftSeed = {}): SeriesDraft => ({
  name: seed.title ?? "",
  enabled: true,
  channels: seed.channel === undefined ? [] : [seed.channel],
  conditions: keyed([
    ...(seed.categories === undefined
      ? []
      : [{ ...blankCondition("Category"), values: seed.categories }]),
    ...(seed.categories !== undefined && seed.title === undefined
      ? []
      : [
          {
            ...blankCondition(seed.kind ?? "StartsWith"),
            values: seed.title === undefined ? [] : [seed.title],
          },
        ]),
  ]),
  weekdays: seed.weekdays ?? [],
  keep: "KeepAll",
  keepCount: 3,
  padding: undefined,
  skipRepeats: true,
  collectionId: undefined,
  base: undefined,
});

/** The editor's view of a saved rule: its own extra time, whatever the defaults say now. */
export const draftFromRule = (rule: Rule): SeriesDraft => {
  const { id: _id, ownerId: _owner, createdAt: _created, offerDeclined: _offer, ...input } = rule;
  const categories = rule.matcher.categories;
  return {
    name: rule.name,
    enabled: rule.enabled,
    channels: rule.matcher.channels,
    conditions: keyed([
      ...rule.matcher.title.map(conditionDraft),
      ...(categories.length === 0 ? [] : [{ ...blankCondition("Category"), values: categories }]),
    ]),
    weekdays: rule.matcher.weekdays,
    keep: rule.retention._tag,
    keepCount:
      rule.retention._tag === "KeepAll"
        ? 3
        : rule.retention._tag === "KeepDays"
          ? rule.retention.days
          : rule.retention.count,
    padding: rule.padding,
    skipRepeats: rule.skipRepeats,
    collectionId: rule.collectionId,
    base: input,
  };
};

const retention = (kind: KeepKind, count: number): Retention => {
  const n = Math.max(1, Math.round(count));
  switch (kind) {
    case "KeepAll":
      return { _tag: "KeepAll" };
    case "KeepNewest":
      return { _tag: "KeepNewest", count: n };
    case "KeepNewestEvents":
      return { _tag: "KeepNewestEvents", count: n };
    case "KeepDays":
      return { _tag: "KeepDays", days: n };
  }
};

const cleanValues = (values: ReadonlyArray<string>): Array<string> =>
  values.map((value) => value.trim()).filter(Boolean);

/** The title conditions a draft stands for. Empty conditions are left out, not sent. */
const titleConditions = (conditions: ReadonlyArray<ConditionDraft>): Array<TitleCondition> =>
  conditions.flatMap((condition): Array<TitleCondition> => {
    if (condition.kind === "Category") return [];
    if (condition.kind === "Regex") {
      const pattern = condition.pattern.trim();
      return pattern === "" ? [] : [{ _tag: "Regex", pattern }];
    }
    const [first, ...rest] = cleanValues(condition.values);
    return first === undefined ? [] : [{ _tag: condition.kind, values: [first, ...rest] }];
  });

/** The guide categories of a draft's "Category is" rows, each once. */
export const draftCategories = (draft: Pick<SeriesDraft, "conditions">): Array<string> => [
  ...new Set(
    draft.conditions.flatMap((condition) =>
      condition.kind === "Category" ? cleanValues(condition.values) : [],
    ),
  ),
];

/**
 * The rule a draft describes, ready to send. `fallback` is the default extra time that applies
 * to the draft right now; it is saved when the draft follows the defaults.
 */
export const toRuleInput = (draft: SeriesDraft, fallback: Padding): RuleDraft => {
  const exportTemplate = draft.base?.exportTemplate;
  const padding = draft.padding ?? fallback;
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    matcher: {
      ...(draft.base?.matcher ?? emptyMatcher),
      channels: draft.channels,
      title: titleConditions(draft.conditions),
      categories: draftCategories(draft),
      weekdays: draft.weekdays,
    },
    padding: {
      beforeMinutes: clampPaddingMinutes(padding.beforeMinutes),
      afterMinutes: clampPaddingMinutes(padding.afterMinutes),
    },
    retention: retention(draft.keep, draft.keepCount),
    skipRepeats: draft.skipRepeats,
    ...(draft.collectionId === undefined ? {} : { collectionId: draft.collectionId }),
    ...(exportTemplate === undefined ? {} : { exportTemplate }),
  };
};

/**
 * The changes to send for a saved series recording (`PATCH`). Automatic is an explicit `null`,
 * since an absent key keeps the old collection. The episode choice is only sent when the person
 * changed it, so an edit never resets a choice another client made meanwhile.
 */
export const toRuleUpdate = (
  draft: SeriesDraft,
  initial: Pick<SeriesDraft, "skipRepeats">,
  fallback: Padding,
): RuleUpdate => {
  const { skipRepeats, ...input } = toRuleInput(draft, fallback);
  return {
    ...input,
    collectionId: input.collectionId ?? null,
    ...(skipRepeats === initial.skipRepeats ? {} : { skipRepeats }),
  };
};

/** How far ahead the editor's preview looks: 14 days, rounded up to the hour. */
const previewHorizonMs = 14 * DAY;

/**
 * The end of the editor's preview window. Rounded to the hour so the editor and the route that
 * prefetches its first preview ask the same question.
 */
export const previewUntil = (now: number): number =>
  Math.ceil((now + previewHorizonMs) / HOUR) * HOUR;

/**
 * What the preview asks the server about a draft: where "Automatic" would put things, so the
 * collection is left out, and enabled, so a paused series recording still shows its matches.
 */
export const previewInput = (input: RuleDraft, fallbackName: string): RuleDraft => {
  const { collectionId: _collection, ...withoutCollection } = input;
  return { ...withoutCollection, name: input.name || fallbackName, enabled: true };
};

/** Something to fix before saving, pointing at the part of the form it concerns. */
export type DraftProblem =
  | { readonly field: "name"; readonly kind: "missing" }
  | { readonly field: "matcher"; readonly kind: "everything" }
  | { readonly field: "matcher"; readonly kind: "duration" }
  | {
      readonly field: "condition";
      readonly kind: "regex";
      readonly index: number;
      readonly pattern: string;
    };

/**
 * What stops a draft from being saved, checked as the person types. The matcher checks are
 * the domain's, so the editor refuses exactly what the server would.
 */
export const draftProblems = (draft: SeriesDraft): Array<DraftProblem> => {
  const problems: Array<DraftProblem> = [];
  if (draft.name.trim() === "") problems.push({ field: "name", kind: "missing" });
  draft.conditions.forEach((condition, index) => {
    if (
      condition.kind === "Regex" &&
      condition.pattern.trim() !== "" &&
      compileRegex(condition.pattern.trim(), false) === undefined
    ) {
      problems.push({ field: "condition", kind: "regex", index, pattern: condition.pattern });
    }
  });
  const matcher = toRuleInput(draft, noPadding).matcher;
  for (const problem of matcherProblems(matcher)) {
    if (problem._tag === "MatchesEverything")
      problems.push({ field: "matcher", kind: "everything" });
    if (problem._tag === "InvertedDuration") problems.push({ field: "matcher", kind: "duration" });
  }
  return problems;
};

/** The first "starts with" value of a draft, which a new collection matches on. */
export const titlePrefix = (draft: Pick<SeriesDraft, "conditions">): string | undefined =>
  draft.conditions
    .find((condition) => condition.kind === "StartsWith")
    ?.values.map((value) => value.trim())
    .find(Boolean);

/**
 * The name a new collection made from the rule editor starts with: the first "starts with"
 * value without its trailing colon ("Live F1:" gives "Live F1"), else the rule's name.
 */
export const collectionNameFor = (draft: Pick<SeriesDraft, "conditions" | "name">): string => {
  const prefix = titlePrefix(draft);
  return prefix === undefined ? draft.name.trim() : seriesDisplayName(prefix);
};

/**
 * The extra time a draft records with and the default it is measured against, from the one
 * domain resolver (SPEC §7.7, open issue 1): a channel override beats a category override,
 * which beats the global default.
 */
export const draftExtraTime = (
  defaults: ExtraTimeDefaults,
  draft: Pick<SeriesDraft, "channels" | "conditions" | "padding">,
): ExtraTimeHint =>
  describeExtraTime(
    defaults,
    { channelIds: draft.channels, categories: draftCategories(draft) },
    draft.padding,
  );

/** The templates a new series recording starts from, by id (the web's `template` param). */
export const seriesTemplateIds = ["series", "news", "sport", "films"] as const;

/** A template's id. */
export type SeriesTemplateId = (typeof seriesTemplateIds)[number];

const weekdaysOnly: ReadonlyArray<Weekday> = ["mon", "tue", "wed", "thu", "fri"];

/** What each template seeds the editor with; its words are `seriesTemplateText` in i18n. */
export const seriesTemplateSeeds: Readonly<Record<SeriesTemplateId, DraftSeed>> = {
  series: { kind: "IsExactly" },
  news: { kind: "StartsWith", weekdays: weekdaysOnly },
  sport: { categories: ["Sport"] },
  films: { categories: ["Spielfilm"] },
};

/**
 * The channels a profile may pick for a series recording: the guide's visible channels in its
 * order, within its access (SPEC §7.8).
 */
export const pickableChannels = <A extends Channel>(
  channels: ReadonlyArray<A>,
  access: AccessPolicy,
): ReadonlyArray<A> =>
  visibleChannels(channels).filter((channel) => canSeeChannel(access, channel.id));

/**
 * What a new collection made inline from the editor holds (SPEC §7.3, §8.3): keyed on the
 * series recording's one channel and title start by `seriesCollection`, so it holds what
 * "Record every…" would; without one channel it keeps any, without a title nothing but the
 * name.
 */
export const newSeriesCollection = (
  name: string,
  scope: {
    /** A programme the draft matches (the preview's first), else its title start. */
    readonly title: string | undefined;
    /** Its one channel; undefined when it records on several or any. */
    readonly channelId: ChannelId | undefined;
  },
): Omit<Collection, "id" | "follows"> => {
  const { matcher, layout } =
    scope.title === undefined
      ? { matcher: emptyMatcher, layout: defaultLayout }
      : seriesCollection({ channelId: scope.channelId, title: scope.title });
  return { name, rank: 0, matcher, labels: [], layout, retention: { _tag: "KeepAll" } };
};

/**
 * The name of the place a group path lands in: its collection's name, else its first folder
 * (the show), else the item itself. "Formel 1" in "Automatic (Formel 1)".
 */
export const groupName = (
  path: GroupPath,
  collections: ReadonlyArray<Pick<Collection, "id" | "name">>,
  labels: PathLabels,
): string => {
  const collection =
    path.collectionId === undefined
      ? undefined
      : collections.find((candidate) => candidate.id === path.collectionId);
  if (collection !== undefined) return collection.name;
  return renderSegment(path.folders[0] ?? path.item, labels);
};

/**
 * Where the editor's preview stands, before it is drawn: waiting for a draft that can be
 * previewed, loading, failed, or ready (`refreshing` while an older answer stays on screen).
 */
export type PreviewStatus<P> =
  | { readonly kind: "waiting" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly preview: P; readonly refreshing: boolean };

/** The preview's status from what the draft and the read say. */
export const previewStatus = <P>(read: {
  /** The draft has problems the preview cannot get past (anything but the name). */
  readonly blocked: boolean;
  readonly data: P | undefined;
  readonly failed: boolean;
  /** The data is an older draft's, kept while the new one loads. */
  readonly refreshing: boolean;
}): PreviewStatus<P> => {
  if (read.blocked) return { kind: "waiting" };
  if (read.data !== undefined) {
    return { kind: "ready", preview: read.data, refreshing: read.refreshing };
  }
  return read.failed ? { kind: "failed" } : { kind: "loading" };
};

/** What "Goes to" shows (recording model §3.3, §3.4), before it is put in words. */
export interface GoesToView<C, O> {
  /** What the profile may pick at all (`goesToOptions`); undefined when it may not record. */
  readonly options: GoesToOptions | undefined;
  /** The collection following this series recording, when one does. */
  readonly following: C | undefined;
  /** The collection picked, when one is. */
  readonly chosen: C | undefined;
  /** The collections it may pick: what the profile may record into, the picked and the following one. */
  readonly allowed: readonly C[];
  /** Where "Automatic" lands today ("Formel 1"), from the preview's first placed match. */
  readonly automaticName: string | undefined;
  /** "Group them?" when Automatic scatters the matches and nothing is picked. */
  readonly offer: O | undefined;
}

/**
 * The view of "Goes to" every client shows: what Automatic means for this draft (from its
 * preview, undefined while there is none), the collection that follows the series recording,
 * and the collections the profile may pick (`goesToOptions`).
 */
export const goesToView = <C extends Pick<Collection, "id" | "name" | "follows">, O>(input: {
  readonly ruleId: Rule["id"] | undefined;
  readonly collectionId: CollectionId | undefined;
  readonly collections: readonly C[];
  readonly access: AccessPolicy;
  readonly mayCreateCollections: boolean;
  readonly preview:
    | {
        readonly matches: ReadonlyArray<{ readonly group?: GroupPath | undefined }>;
        readonly offer?: O | undefined;
      }
    | undefined;
  readonly labels: PathLabels;
}): GoesToView<C, O> => {
  const { collections, collectionId } = input;
  const firstGroup = input.preview?.matches.find((match) => match.group !== undefined)?.group;
  const following =
    input.ruleId === undefined
      ? undefined
      : collections.find((collection) => collection.follows?.ruleId === input.ruleId);
  const goes = goesToOptions(
    input.access,
    collections.map((collection) => collection.id),
    { mayCreateCollections: input.mayCreateCollections },
  );
  return {
    options: goes,
    following,
    chosen: collections.find((collection) => collection.id === collectionId),
    allowed: collections.filter(
      (collection) =>
        goes === undefined ||
        goes.collectionIds.includes(collection.id) ||
        collection.id === collectionId ||
        collection.id === following?.id,
    ),
    automaticName:
      firstGroup === undefined ? undefined : groupName(firstGroup, collections, input.labels),
    offer: collectionId === undefined ? input.preview?.offer : undefined,
  };
};

/**
 * How many of the preview's matches get recorded: all but the episodes the owner already has or
 * has scheduled. The same airing scheduled by hand or by another series recording still is.
 */
export const recordedCount = (
  matches: ReadonlyArray<{ readonly skip?: RuleMatchSkip | undefined }>,
): number => matches.filter((match) => match.skip?._tag !== "Repeat").length;

/**
 * How a preview row is marked when the series recording would not record it itself (§3.2),
 * before it is put in words (`seriesSkipMark` in i18n): the same airing as a scheduled recording
 * (said only for a new draft: a saved one scheduled most of its matches itself), a guide entry
 * listed twice, or an episode the owner already has or has scheduled, with when, in the
 * household's zone. `state` is how every client phrases that copy (`repeatKind`).
 */
export type SkipMarkParts =
  | { readonly kind: "same" }
  | { readonly kind: "duplicate" }
  | {
      readonly kind: "repeat";
      readonly state: RepeatKind;
      readonly day: Weekday;
      readonly date: number;
      readonly epochMs: number;
    };

/** The parts of a preview row's skip mark, or none when the row is marked no further. */
export const skipMarkParts = (
  skip: RuleMatchSkip,
  options: { readonly isNew: boolean; readonly timeZone: string },
): SkipMarkParts | undefined => {
  switch (skip._tag) {
    case "SameAiring":
      return options.isNew ? { kind: "same" } : undefined;
    case "DuplicateEntry":
      return { kind: "duplicate" };
    case "Repeat": {
      const parts = localParts(skip.of.start, options.timeZone);
      return {
        kind: "repeat",
        state: repeatKind(skip.of),
        day: parts.weekday,
        date: parts.day,
        epochMs: epochMs(skip.of.start),
      };
    }
  }
};

/** One run of a title in the preview: plain, or the part a condition matched. */
export interface TitleRun {
  readonly text: string;
  readonly marked: boolean;
}

/**
 * Splits a programme title into runs, marking what the rule's title conditions matched
 * ("Live F1:" in "Live F1: Qualifying - GP Katar"), with the domain's own matcher so the marks
 * show exactly what the server matched. Overlapping hits merge.
 */
export const markTitle = (
  title: string,
  conditions: ReadonlyArray<TitleCondition>,
): Array<TitleRun> => {
  const text = normaliseText(title);
  const ranges = conditions
    .flatMap((condition) => {
      if ((condition.field ?? "title") !== "title") return [];
      const hit = matchTitleCondition(condition, { title: text });
      return hit === undefined || hit.text === "" ? [] : [[hit.index, hit.index + hit.text.length]];
    })
    .toSorted((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  const merged: Array<Array<number>> = [];
  for (const [start = 0, end = 0] of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && start <= (last[1] ?? 0)) last[1] = Math.max(last[1] ?? 0, end);
    else merged.push([start, end]);
  }
  const runs: Array<TitleRun> = [];
  let at = 0;
  for (const [start = 0, end = 0] of merged) {
    if (start > at) runs.push({ text: text.slice(at, start), marked: false });
    runs.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length) runs.push({ text: text.slice(at), marked: false });
  return runs;
};
