import { Schema } from "effect";
import { ChannelId } from "./ids.ts";
import {
  compileRegex,
  matchTitleCondition,
  type RegexHazard,
  regexHazard,
  TitleCondition,
  TitleField,
  type TitleHit,
  titleValueMaxLength,
  titleValuesMax,
} from "./title.ts";
import { durationMillis, type Instant, localParts, MINUTE, Weekday } from "./time.ts";

const Minutes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * What rules and collections match on. Every non-empty criterion must hold; inside a criterion,
 * any listed value is enough. Empty lists place no restriction.
 */
export const Matcher = Schema.Struct({
  channels: Schema.Array(ChannelId),
  title: Schema.Array(TitleCondition),
  /** Guide categories, compared case-insensitively ("Spielfilm"). */
  categories: Schema.Array(Schema.String.check(Schema.isMaxLength(titleValueMaxLength))).check(
    Schema.isMaxLength(titleValuesMax),
  ),
  weekdays: Schema.Array(Weekday),
  minDurationMinutes: Schema.optionalKey(Minutes),
  maxDurationMinutes: Schema.optionalKey(Minutes),
}).annotate({ identifier: "Matcher" });
export type Matcher = typeof Matcher.Type;

/** An empty matcher, the starting point for editors and tests. */
export const emptyMatcher: Matcher = { channels: [], title: [], categories: [], weekdays: [] };

/** What a matcher reads from a programme or recording. */
export interface MatchSubject {
  readonly channelId: ChannelId;
  readonly start: Instant;
  readonly end: Instant;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly categories: ReadonlyArray<string>;
}

/** One reason a matcher matched, for explanations like "because the title starts with 'F1:'". */
export type MatchedCriterion =
  | { readonly _tag: "Channel"; readonly channelId: ChannelId }
  | { readonly _tag: "Title"; readonly hit: TitleHit }
  | { readonly _tag: "Category"; readonly category: string }
  | { readonly _tag: "Weekday"; readonly weekday: Weekday }
  | { readonly _tag: "Duration" }
  | { readonly _tag: "Label"; readonly label: string };

/** The wire form of a matched criterion, enough for the client to phrase the "why". */
export const CriterionSummary = Schema.TaggedUnion({
  Channel: { channelId: ChannelId },
  Title: {
    condition: Schema.Literals(["StartsWith", "Contains", "IsExactly", "Regex"]),
    field: TitleField,
    value: Schema.String,
  },
  Category: { category: Schema.String },
  Weekday: { weekday: Weekday },
  Duration: {},
  Label: { label: Schema.String },
}).annotate({ identifier: "CriterionSummary" });
export type CriterionSummary = typeof CriterionSummary.Type;

/** Drops match positions and regex groups, keeping what an explanation needs. */
export const summariseCriterion = (criterion: MatchedCriterion): CriterionSummary =>
  criterion._tag === "Title"
    ? {
        _tag: "Title",
        condition: criterion.hit.condition,
        field: criterion.hit.field,
        value: criterion.hit.value,
      }
    : criterion;

/** A successful match. */
export interface MatchResult {
  readonly criteria: ReadonlyArray<MatchedCriterion>;
  readonly titleHits: ReadonlyArray<TitleHit>;
}

/**
 * Checks a subject against a matcher. Weekdays are read in `timeZone`, the household's zone, so a
 * Saturday-night programme stays on Saturday. Returns `undefined` when any criterion fails.
 */
export const evaluateMatcher = (
  matcher: Matcher,
  subject: MatchSubject,
  timeZone: string,
): MatchResult | undefined => {
  const criteria: Array<MatchedCriterion> = [];

  if (matcher.channels.length > 0) {
    if (!matcher.channels.includes(subject.channelId)) return undefined;
    criteria.push({ _tag: "Channel", channelId: subject.channelId });
  }

  const titleHits: Array<TitleHit> = [];
  for (const condition of matcher.title) {
    const hit = matchTitleCondition(condition, subject);
    if (hit === undefined) return undefined;
    titleHits.push(hit);
    criteria.push({ _tag: "Title", hit });
  }

  if (matcher.categories.length > 0) {
    const wanted = new Set(matcher.categories.map((category) => category.toLowerCase()));
    const category = subject.categories.find((candidate) => wanted.has(candidate.toLowerCase()));
    if (category === undefined) return undefined;
    criteria.push({ _tag: "Category", category });
  }

  if (matcher.weekdays.length > 0) {
    const { weekday } = localParts(subject.start, timeZone);
    if (!matcher.weekdays.includes(weekday)) return undefined;
    criteria.push({ _tag: "Weekday", weekday });
  }

  if (matcher.minDurationMinutes !== undefined || matcher.maxDurationMinutes !== undefined) {
    const minutes = durationMillis({ start: subject.start, end: subject.end }) / MINUTE;
    if (matcher.minDurationMinutes !== undefined && minutes < matcher.minDurationMinutes) {
      return undefined;
    }
    if (matcher.maxDurationMinutes !== undefined && minutes > matcher.maxDurationMinutes) {
      return undefined;
    }
    criteria.push({ _tag: "Duration" });
  }

  return { criteria, titleHits };
};

/** Something an editor should refuse to save. */
export type MatcherProblem =
  | { readonly _tag: "MatchesEverything" }
  | { readonly _tag: "InvalidRegex"; readonly pattern: string }
  /** A pattern that could backtrack for a very long time (see `regexHazard`); it never runs. */
  | { readonly _tag: "UnsafeRegex"; readonly pattern: string; readonly hazard: RegexHazard }
  | { readonly _tag: "InvertedDuration" };

/**
 * Validates a matcher before saving. A matcher with neither channels, title conditions nor
 * categories would match the whole guide, which is never what someone meant, and a regex that
 * could backtrack without end is refused before anything runs it.
 */
export const matcherProblems = (matcher: Matcher): Array<MatcherProblem> => {
  const problems: Array<MatcherProblem> = [];
  if (
    matcher.channels.length === 0 &&
    matcher.title.length === 0 &&
    matcher.categories.length === 0
  ) {
    problems.push({ _tag: "MatchesEverything" });
  }
  for (const condition of matcher.title) {
    if (condition._tag !== "Regex") continue;
    const hazard = regexHazard(condition.pattern);
    if (hazard !== undefined) {
      problems.push({ _tag: "UnsafeRegex", pattern: condition.pattern, hazard });
    } else if (compileRegex(condition.pattern, condition.caseSensitive ?? false) === undefined) {
      problems.push({ _tag: "InvalidRegex", pattern: condition.pattern });
    }
  }
  if (
    matcher.minDurationMinutes !== undefined &&
    matcher.maxDurationMinutes !== undefined &&
    matcher.minDurationMinutes > matcher.maxDurationMinutes
  ) {
    problems.push({ _tag: "InvertedDuration" });
  }
  return problems;
};
