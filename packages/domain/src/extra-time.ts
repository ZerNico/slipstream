import { Schema } from "effect";
import { ChannelId, RuleId } from "./ids.ts";
import { normaliseText } from "./title.ts";
import { Padding, paddingEquals } from "./time.ts";

/**
 * One override of the default extra time (SPEC 7.7): for a channel ("Sky Sport F1 HD 5/60") or a
 * guide category ("Sport 5/60", "Film 2/15"). A channel override beats a category override.
 */
export const ExtraTimeOverride = Schema.TaggedUnion({
  Channel: { channelId: ChannelId, padding: Padding },
  Category: { category: Schema.NonEmptyString, padding: Padding },
}).annotate({ identifier: "ExtraTimeOverride" });
export type ExtraTimeOverride = typeof ExtraTimeOverride.Type;

/**
 * The household's default extra time: the global value plus overrides. Every new rule and every
 * one-off recording starts from the matching value; changing a default never rewrites existing
 * rules or scheduled recordings.
 */
export const ExtraTimeDefaults = Schema.Struct({
  /** "Everything": used when no override matches. */
  padding: Padding,
  /** Category overrides are tried in this order; the first that matches wins among them. */
  overrides: Schema.Array(ExtraTimeOverride),
}).annotate({ identifier: "ExtraTimeDefaults" });
export type ExtraTimeDefaults = typeof ExtraTimeDefaults.Type;

/** The value SPEC 7.7 ships with: 2 minutes early, 10 after, no overrides. */
export const initialExtraTimeDefaults: ExtraTimeDefaults = {
  padding: { beforeMinutes: 2, afterMinutes: 10 },
  overrides: [],
};

/**
 * Where an extra-time value comes from, so every hint can name it: "From your Sky Sport F1 HD
 * default", "From your Sport default", "From your default", or a rule's own values.
 */
export const ExtraTimeSource = Schema.TaggedUnion({
  Global: {},
  Channel: { channelId: ChannelId },
  Category: { category: Schema.NonEmptyString },
  /** A rule's own values, which always win in every copy that quotes them. */
  Rule: { ruleId: Schema.optionalKey(RuleId) },
}).annotate({ identifier: "ExtraTimeSource" });
export type ExtraTimeSource = typeof ExtraTimeSource.Type;

/** An extra-time value and where it comes from. */
export const EffectiveExtraTime = Schema.Struct({
  padding: Padding,
  source: ExtraTimeSource,
}).annotate({ identifier: "EffectiveExtraTime" });
export type EffectiveExtraTime = typeof EffectiveExtraTime.Type;

/**
 * What the default depends on. A programme has one channel; a rule passes the channels and
 * categories of its matcher.
 */
export interface ExtraTimeSubject {
  readonly channelIds: ReadonlyArray<ChannelId>;
  readonly categories: ReadonlyArray<string>;
}

const categoryKey = (category: string): string => normaliseText(category).toLowerCase();

const channelOverride = (
  defaults: ExtraTimeDefaults,
  channelId: ChannelId,
): Extract<ExtraTimeOverride, { _tag: "Channel" }> | undefined =>
  defaults.overrides.find(
    (override): override is Extract<ExtraTimeOverride, { _tag: "Channel" }> =>
      override._tag === "Channel" && override.channelId === channelId,
  );

/**
 * The default extra time for a programme or a rule draft (SPEC 7.7): a channel override beats a
 * category override, which beats the global default. With several channels (a rule on two
 * channels) the channel step applies only when every channel has an override with the same
 * values, so the hint never claims a channel default that holds for just one of them. Categories
 * compare case-insensitively with whitespace collapsed; the first matching category override in
 * the list wins.
 */
export const defaultExtraTime = (
  defaults: ExtraTimeDefaults,
  subject: ExtraTimeSubject,
): EffectiveExtraTime => {
  const [firstChannel, ...otherChannels] = subject.channelIds;
  if (firstChannel !== undefined) {
    const first = channelOverride(defaults, firstChannel);
    if (
      first !== undefined &&
      otherChannels.every((channelId) => {
        const other = channelOverride(defaults, channelId);
        return other !== undefined && paddingEquals(other.padding, first.padding);
      })
    ) {
      return { padding: first.padding, source: { _tag: "Channel", channelId: firstChannel } };
    }
  }
  const wanted = new Set(subject.categories.map(categoryKey));
  for (const override of defaults.overrides) {
    if (override._tag === "Category" && wanted.has(categoryKey(override.category))) {
      return {
        padding: override.padding,
        source: { _tag: "Category", category: override.category },
      };
    }
  }
  return { padding: defaults.padding, source: { _tag: "Global" } };
};

/** What a hint next to the extra-time steppers says, and the values the steppers show. */
export interface ExtraTimeHint {
  /** The values to show and record with: the chosen ones, else the default. */
  readonly padding: Padding;
  /** The default that applies to this subject, for "From your … default" or "Overrides …". */
  readonly fallback: EffectiveExtraTime;
  /** True when `chosen` differs from the default: "Overrides your default (…) for this rule". */
  readonly overridesDefault: boolean;
}

/**
 * The one resolver behind every extra-time hint (programme sheet, rule editor, hero copy), so the
 * hint's numbers always equal the steppers' (IMPLEMENTATION-NOTES open issue 1). `chosen` is the
 * rule's or recording's own padding when it has one.
 */
export const describeExtraTime = (
  defaults: ExtraTimeDefaults,
  subject: ExtraTimeSubject,
  chosen?: Padding,
): ExtraTimeHint => {
  const fallback = defaultExtraTime(defaults, subject);
  const padding = chosen ?? fallback.padding;
  return { padding, fallback, overridesDefault: !paddingEquals(padding, fallback.padding) };
};

/** Something wrong with a set of defaults, for the settings form. */
export type ExtraTimeDefaultsProblem =
  | { readonly _tag: "DuplicateChannel"; readonly index: number; readonly channelId: ChannelId }
  | { readonly _tag: "DuplicateCategory"; readonly index: number; readonly category: string };

/**
 * Validates defaults before saving: one override per channel and one per category (compared the
 * way {@link defaultExtraTime} compares them). `index` points into `overrides`.
 */
export const extraTimeDefaultsProblems = (
  defaults: ExtraTimeDefaults,
): Array<ExtraTimeDefaultsProblem> => {
  const channels = new Set<string>();
  const categories = new Set<string>();
  const problems: Array<ExtraTimeDefaultsProblem> = [];
  defaults.overrides.forEach((override, index) => {
    if (override._tag === "Channel") {
      if (channels.has(override.channelId)) {
        problems.push({ _tag: "DuplicateChannel", index, channelId: override.channelId });
      }
      channels.add(override.channelId);
    } else {
      const key = categoryKey(override.category);
      if (categories.has(key)) {
        problems.push({ _tag: "DuplicateCategory", index, category: override.category });
      }
      categories.add(key);
    }
  });
  return problems;
};

/*
 * Pure edits of the recording defaults form (Settings › Recording, on every client): change a
 * value, add or remove an exception. The server checks the same rules on save.
 */

/** Replaces the global default's padding. */
export const setGlobalPadding = (
  defaults: ExtraTimeDefaults,
  padding: Padding,
): ExtraTimeDefaults => ({ ...defaults, padding });

/** Replaces one override's padding. */
export const setOverridePadding = (
  defaults: ExtraTimeDefaults,
  index: number,
  padding: Padding,
): ExtraTimeDefaults => ({
  ...defaults,
  overrides: defaults.overrides.map((override, at) =>
    at === index ? { ...override, padding } : override,
  ),
});

/** Removes one override. */
export const removeOverride = (defaults: ExtraTimeDefaults, index: number): ExtraTimeDefaults => ({
  ...defaults,
  overrides: defaults.overrides.filter((_, at) => at !== index),
});

/**
 * Adds an override at the end, or answers `duplicate` when the channel or category already has
 * one (compared the way {@link defaultExtraTime} compares them).
 */
export const addOverride = (
  defaults: ExtraTimeDefaults,
  override: ExtraTimeOverride,
): ExtraTimeDefaults | "duplicate" => {
  const next = { ...defaults, overrides: [...defaults.overrides, override] };
  return extraTimeDefaultsProblems(next).length > extraTimeDefaultsProblems(defaults).length
    ? "duplicate"
    : next;
};

/** Channels that have no override yet, for the "Add exception" picker. */
export const channelsWithoutOverride = <C extends { readonly id: ChannelId }>(
  defaults: ExtraTimeDefaults,
  channels: readonly C[],
): C[] => {
  const taken = new Set(
    defaults.overrides.flatMap((override) =>
      override._tag === "Channel" ? [override.channelId] : [],
    ),
  );
  return channels.filter((channel) => !taken.has(channel.id));
};
