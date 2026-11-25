import { Schema } from "effect";
import { CollectionId, RuleId } from "./ids.ts";
import {
  CriterionSummary,
  evaluateMatcher,
  Matcher,
  type MatchResult,
  type MatchSubject,
  summariseCriterion,
} from "./matcher.ts";
import { builtInVariables, TitlePart } from "./parts.ts";
import { Retention } from "./recording.ts";
import { normaliseText, type TitleCondition } from "./title.ts";

/**
 * How a collection lays out its recordings below its own name. `path` holds templates such as
 * `["{year}", "{event}", "{programme}"]`; the last one names the item, the others are folders.
 */
export const CollectionLayout = Schema.Struct({
  parts: Schema.Array(TitlePart),
  path: Schema.Array(Schema.String),
  /** First month of a sports season: 8 renders `{season}` in November 2026 as "2026/27". */
  seasonStartMonth: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  ),
}).annotate({ identifier: "CollectionLayout" });
export type CollectionLayout = typeof CollectionLayout.Type;

/** The layout a collection gets unless its titles say more: a folder per year, then programmes. */
export const defaultLayout: CollectionLayout = {
  parts: [{ _tag: "Split", name: "programme" }],
  path: ["{year}", "{programme}"],
};

const collectionFields = {
  id: CollectionId,
  name: Schema.NonEmptyString,
  /** The user's ranking, lower first; the last tie-breaker between overlapping collections. */
  rank: Schema.Int,
  /** Recordings carrying any of these labels belong here too, whatever the matcher says. */
  labels: Schema.Array(Schema.String),
  layout: CollectionLayout,
  retention: Schema.optionalKey(Retention),
};

/** The series recording a linked collection follows (recording model §3.4). */
export const CollectionFollows = Schema.Struct({
  ruleId: RuleId,
  /** The series recording's name, for "Follows the series recording “Live F1”". */
  ruleName: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "CollectionFollows" });
export type CollectionFollows = typeof CollectionFollows.Type;

/**
 * A household-wide group of recordings: what belongs together and how it is laid out. Its
 * `matcher` is always the effective one: its own, or, for a collection that follows a series
 * recording, that recording's *what* conditions. Only `resolveCollections` makes one from what
 * is stored, so placement, preview, suggestions, export and retention never see an unresolved
 * matcher.
 */
export const Collection = Schema.Struct({
  ...collectionFields,
  matcher: Matcher,
  /** Set when the collection follows a series recording's conditions. */
  follows: Schema.optionalKey(CollectionFollows),
}).annotate({ identifier: "Collection" });
export type Collection = typeof Collection.Type;

/**
 * Where a stored collection's conditions come from: its own matcher, or the series recording it
 * follows, with a snapshot of that recording's *what* conditions (rewritten on every save of the
 * rule), used when the rule is missing and copied when the collection is unlinked.
 */
export const CollectionSource = Schema.TaggedUnion({
  Own: { matcher: Matcher },
  FollowsRule: { ruleId: RuleId, snapshot: Matcher },
}).annotate({ identifier: "CollectionSource" });
export type CollectionSource = typeof CollectionSource.Type;

/** A collection as stored: its conditions not yet resolved (`resolveCollections`). */
export const StoredCollection = Schema.Struct({
  ...collectionFields,
  source: CollectionSource,
}).annotate({ identifier: "StoredCollection" });
export type StoredCollection = typeof StoredCollection.Type;

/** What resolving reads from a series recording. */
export interface FollowedRule {
  readonly id: RuleId;
  readonly name: string;
  readonly matcher: Matcher;
  readonly collectionId?: CollectionId | undefined;
}

/**
 * A matcher's *what* conditions: channels, title conditions and categories. Weekdays and
 * duration decide what gets recorded, not what a programme is, so a linked collection leaves
 * them out (a Saturday press conference recorded by hand still lands in Formel 1).
 */
export const whatConditions = (matcher: Matcher): Matcher => ({
  channels: matcher.channels,
  title: matcher.title,
  categories: matcher.categories,
  weekdays: [],
});

/**
 * Whether a matcher names any *what* condition (channels, titles or categories). A linked
 * collection whose followed rule has none falls back to its snapshot instead of matching all.
 */
export const hasWhatConditions = (matcher: Matcher): boolean =>
  matcher.channels.length > 0 || matcher.title.length > 0 || matcher.categories.length > 0;

/**
 * Turns stored collections into usable ones (§3.4): an own matcher as it is; a linked one gets
 * the followed series recording's *what* conditions and `follows`. When the rule is missing or
 * its conditions are empty, the snapshot is used, so a linked collection never fails open with
 * an empty matcher.
 */
export const resolveCollections = (
  stored: ReadonlyArray<StoredCollection>,
  rules: ReadonlyArray<FollowedRule>,
): Array<Collection> =>
  stored.map(({ source, ...collection }): Collection => {
    if (source._tag === "Own") return { ...collection, matcher: source.matcher };
    const rule = rules.find((candidate) => candidate.id === source.ruleId);
    const live = rule === undefined ? undefined : whatConditions(rule.matcher);
    return {
      ...collection,
      matcher: live !== undefined && hasWhatConditions(live) ? live : source.snapshot,
      follows: {
        ruleId: source.ruleId,
        ...(rule === undefined ? {} : { ruleName: rule.name }),
      },
    };
  });

/** A break of the link invariant `collection follows R ⇒ R.collectionId = collection.id`. */
export interface LinkProblem {
  /**
   * `MissingRule`: the followed series recording does not exist. `NotPointedBack`: it records
   * into another collection, or none. `FollowedTwice`: two collections follow it.
   */
  readonly _tag: "MissingRule" | "NotPointedBack" | "FollowedTwice";
  readonly collectionId: CollectionId;
  readonly ruleId: RuleId;
}

/**
 * Lists the breaks of the link invariant of §3.4 over every stored collection. It only reports:
 * no write path calls it, so it never stops a break from being stored. Meant for tests and for a
 * consistency check that logs what it finds.
 */
export const linkProblems = (
  collections: ReadonlyArray<StoredCollection>,
  rules: ReadonlyArray<FollowedRule>,
): Array<LinkProblem> => {
  const problems: Array<LinkProblem> = [];
  const followed = new Set<RuleId>();
  for (const collection of collections) {
    if (collection.source._tag !== "FollowsRule") continue;
    const { ruleId } = collection.source;
    const ids = { collectionId: collection.id, ruleId };
    if (followed.has(ruleId)) problems.push({ _tag: "FollowedTwice", ...ids });
    followed.add(ruleId);
    const rule = rules.find((candidate) => candidate.id === ruleId);
    if (rule === undefined) problems.push({ _tag: "MissingRule", ...ids });
    else if (rule.collectionId !== collection.id) problems.push({ _tag: "NotPointedBack", ...ids });
  }
  return problems;
};

const conditionKey = (condition: TitleCondition): string => {
  const head = `${condition._tag}|${condition.field ?? "title"}|${condition.caseSensitive === true}`;
  if (condition._tag === "Regex") return `${head}|${condition.pattern}`;
  const fold = (value: string) =>
    condition.caseSensitive === true ? normaliseText(value) : normaliseText(value).toLowerCase();
  return `${head}|${[...new Set(condition.values.map(fold))].toSorted().join("\u0000")}`;
};

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
};

/**
 * Whether two matchers have the same *what* conditions (§6): channels as a set, title
 * conditions as a set of (kind, normalised values, case flag), categories as a case-insensitive
 * set. Weekdays and duration bounds are not compared.
 */
export const matcherEquals = (a: Matcher, b: Matcher): boolean =>
  sameSet(a.channels, b.channels) &&
  sameSet(a.title.map(conditionKey), b.title.map(conditionKey)) &&
  sameSet(
    a.categories.map((category) => normaliseText(category).toLowerCase()),
    b.categories.map((category) => normaliseText(category).toLowerCase()),
  );

/** What collection matching reads from a recording. */
export interface CollectionSubject extends MatchSubject {
  readonly labels: ReadonlyArray<string>;
  readonly ruleId?: RuleId | undefined;
  readonly pinnedCollectionId?: CollectionId | undefined;
}

const restricts = (matcher: Matcher): boolean =>
  matcher.channels.length > 0 ||
  matcher.title.length > 0 ||
  matcher.categories.length > 0 ||
  matcher.weekdays.length > 0 ||
  matcher.minDurationMinutes !== undefined ||
  matcher.maxDurationMinutes !== undefined;

/**
 * Matches a recording against one collection: by label, or by the matcher. A matcher without any
 * criterion matches nothing here, so a label-only collection never swallows the library.
 */
export const matchCollection = (
  collection: Collection,
  subject: CollectionSubject,
  timeZone: string,
): MatchResult | undefined => {
  const label = subject.labels.find((candidate) => collection.labels.includes(candidate));
  const viaMatcher = restricts(collection.matcher)
    ? evaluateMatcher(collection.matcher, subject, timeZone)
    : undefined;
  if (viaMatcher !== undefined) {
    return label === undefined
      ? viaMatcher
      : { ...viaMatcher, criteria: [...viaMatcher.criteria, { _tag: "Label", label }] };
  }
  return label === undefined ? undefined : { criteria: [{ _tag: "Label", label }], titleHits: [] };
};

/**
 * How specific a match is, compared left to right: channel-restricted beats title-only, then a
 * longer matched title text beats a shorter one ("Live F1:" beats "F1:"), then more criteria
 * beat fewer.
 */
export const specificity = (match: MatchResult): readonly [number, number, number] => [
  match.criteria.some((criterion) => criterion._tag === "Channel") ? 1 : 0,
  match.titleHits.reduce((sum, hit) => sum + hit.text.length, 0),
  match.criteria.length,
];

const compareSpecificity = (a: MatchResult, b: MatchResult): number => {
  const left = specificity(a);
  const right = specificity(b);
  for (let index = 0; index < left.length; index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** Why a recording sits in its collection; the detail view turns this into a sentence. */
export const PlacementReason = Schema.Literals([
  "pinned",
  "rule",
  "only",
  "specificity",
  "ranking",
]);
export type PlacementReason = typeof PlacementReason.Type;

/** The collection that won, why, and what else matched. */
export interface CollectionPlacement {
  readonly collection: Collection;
  readonly reason: PlacementReason;
  /** The match that placed it; absent for pinned and rule placements without a match. */
  readonly match?: MatchResult | undefined;
  /** Other collections that also matched and lost. */
  readonly alsoMatched: ReadonlyArray<CollectionId>;
}

/**
 * Picks the one collection a recording belongs to (PLAN 6.6): pinned by hand, then the
 * collection the recording's rule points to, then the most specific matcher, then the user's
 * ranking. Returns `undefined` when nothing applies.
 */
export const placeInCollection = (
  collections: ReadonlyArray<Collection>,
  subject: CollectionSubject,
  options: {
    readonly timeZone: string;
    /** The collection of the rule that recorded it, if any. */
    readonly ruleCollectionId?: CollectionId | undefined;
  },
): CollectionPlacement | undefined => {
  const matches = collections.flatMap((collection) => {
    const match = matchCollection(collection, subject, options.timeZone);
    return match === undefined ? [] : [{ collection, match }];
  });
  const others = (winner: CollectionId) =>
    matches.flatMap(({ collection }) => (collection.id === winner ? [] : [collection.id]));

  const fixed: ReadonlyArray<readonly [CollectionId | undefined, PlacementReason]> = [
    [subject.pinnedCollectionId, "pinned"],
    [options.ruleCollectionId, "rule"],
  ];
  for (const [id, reason] of fixed) {
    const collection = collections.find((candidate) => candidate.id === id);
    if (collection !== undefined) {
      const match = matches.find((candidate) => candidate.collection.id === id)?.match;
      return { collection, reason, match, alsoMatched: others(collection.id) };
    }
  }

  const ranked = matches.toSorted(
    (a, b) =>
      compareSpecificity(a.match, b.match) ||
      a.collection.rank - b.collection.rank ||
      a.collection.id.localeCompare(b.collection.id),
  );
  const [winner, runnerUp] = ranked;
  if (winner === undefined) return undefined;
  const reason: PlacementReason =
    runnerUp === undefined
      ? "only"
      : compareSpecificity(winner.match, runnerUp.match) < 0
        ? "specificity"
        : "ranking";
  return {
    collection: winner.collection,
    reason,
    match: winner.match,
    alsoMatched: others(winner.collection.id),
  };
};

/** The wire form of a placement: which collection, why, and what else matched. */
export const PlacementExplanation = Schema.Struct({
  collectionId: CollectionId,
  reason: PlacementReason,
  criteria: Schema.Array(CriterionSummary),
  alsoMatched: Schema.Array(CollectionId),
}).annotate({ identifier: "PlacementExplanation" });
export type PlacementExplanation = typeof PlacementExplanation.Type;

/**
 * Explains a placement for the detail view, e.g. reason "only" with a `StartsWith` "F1:"
 * criterion reads "In Formel 1 because the title starts with 'F1:'".
 */
export const explainPlacement = (placement: CollectionPlacement): PlacementExplanation => ({
  collectionId: placement.collection.id,
  reason: placement.reason,
  criteria: (placement.match?.criteria ?? []).map(summariseCriterion),
  alsoMatched: placement.alsoMatched,
});

/**
 * For the overlap warning when saving a collection: which of the sample recordings the draft
 * shares with each other collection.
 */
export const collectionOverlaps = <S extends CollectionSubject>(
  draft: Collection,
  others: ReadonlyArray<Collection>,
  samples: ReadonlyArray<S>,
  timeZone: string,
): Array<{ readonly collection: Collection; readonly shared: ReadonlyArray<S> }> => {
  const inDraft = samples.filter((sample) => matchCollection(draft, sample, timeZone));
  return others
    .filter((other) => other.id !== draft.id)
    .map((collection) => ({
      collection,
      shared: inDraft.filter((sample) => matchCollection(collection, sample, timeZone)),
    }))
    .filter((overlap) => overlap.shared.length > 0);
};

/** Something wrong with a collection layout, for the editor. */
export type LayoutProblem =
  | { readonly _tag: "UnknownVariable"; readonly name: string }
  | { readonly _tag: "ReservedPartName"; readonly name: string }
  | { readonly _tag: "DuplicatePartName"; readonly name: string };

const variablePattern = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;

/** The variable names a path template uses, in order. */
export const templateVariables = (template: string): Array<string> =>
  Array.from(template.matchAll(variablePattern), (match) => match[1] ?? "");

/**
 * Validates a layout: parts must not shadow built-in variables or each other, and every
 * variable in the path must be built in, a part, or one of `extraNames` (regex group names).
 */
export const layoutProblems = (
  layout: CollectionLayout,
  extraNames: ReadonlyArray<string> = [],
): Array<LayoutProblem> => {
  const problems: Array<LayoutProblem> = [];
  const builtIn = new Set<string>(builtInVariables);
  const seen = new Set<string>();
  for (const part of layout.parts) {
    if (builtIn.has(part.name)) problems.push({ _tag: "ReservedPartName", name: part.name });
    else if (seen.has(part.name)) problems.push({ _tag: "DuplicatePartName", name: part.name });
    seen.add(part.name);
  }
  const known = new Set([...builtIn, ...seen, ...extraNames]);
  for (const template of layout.path) {
    for (const name of templateVariables(template)) {
      if (!known.has(name)) problems.push({ _tag: "UnknownVariable", name });
    }
  }
  return problems;
};
