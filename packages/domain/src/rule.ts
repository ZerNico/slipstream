import { Effect, Schema, Struct } from "effect";
import { CollectionId, RuleId, UserId } from "./ids.ts";
import { evaluateMatcher, Matcher, type MatchResult } from "./matcher.ts";
import type { Programme } from "./programme.ts";
import { Retention } from "./recording.ts";
import { templateVariables } from "./collection.ts";
import { builtInVariables } from "./parts.ts";
import { Instant, Padding, padRange, type TimeRange } from "./time.ts";

/** The longest rule name; long enough for any title "Record every…" names a rule after. */
export const ruleNameMaxLength = 200;
/** The longest export path template a rule takes. */
export const exportTemplateMaxLength = 512;

/** A standing order to record whatever matches. Rules decide what is recorded, not where. */
export const Rule = Schema.Struct({
  id: RuleId,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(ruleNameMaxLength)),
  enabled: Schema.Boolean,
  ownerId: UserId,
  matcher: Matcher,
  /** Start early / keep after. */
  padding: Padding,
  retention: Retention,
  /** The collection recordings of this rule go to; wins over matcher specificity. */
  collectionId: Schema.optionalKey(CollectionId),
  /**
   * Export path template, overriding the global one: relative, inside the export folder, with
   * known `{variables}` only (`exportTemplateProblems`). Only admins set it.
   */
  exportTemplate: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(exportTemplateMaxLength)),
  ),
  createdAt: Instant,
  /**
   * "Only episodes you don't have yet" (true) or "Every airing" (false): whether an airing of an
   * episode the owner already has or has scheduled is left out (recording model §3.6).
   */
  skipRepeats: Schema.Boolean,
  /** The owner said "No thanks" to grouping its programmes in a collection (§3.3). */
  offerDeclined: Schema.Boolean,
}).annotate({ identifier: "Rule" });
export type Rule = typeof Rule.Type;

/** Fields the server sets: who, when, and the answer to the collection offer (its own action). */
const serverFields = ["id", "ownerId", "createdAt", "offerDeclined"] as const;

/**
 * What someone sends to create a rule; the owner is the caller. `skipRepeats` may be left out
 * (older TV builds) and then means "Only episodes you don't have yet". `offerDeclined` is set
 * only by `POST /rules/:id/offer/decline`.
 */
export const RuleInput = Rule.mapFields((fields) => ({
  ...Struct.omit(fields, [...serverFields, "skipRepeats"]),
  skipRepeats: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
})).annotate({
  identifier: "RuleInput",
});
export type RuleInput = typeof RuleInput.Type;

/** What a client sends to make a rule: no id, owner, creation time or offer answer. */
export type RuleDraft = RuleInput;

/**
 * A partial update; absent fields stay as they are, so an older client that does not know
 * `skipRepeats` never resets it. `collectionId: null` sends the rule back to Automatic (an absent
 * key cannot say that).
 */
export const RuleUpdate = Rule.mapFields((fields) => ({
  ...Struct.map(Struct.omit(fields, [...serverFields, "collectionId"]), Schema.optionalKey),
  collectionId: Schema.optionalKey(Schema.NullOr(CollectionId)),
})).annotate({
  identifier: "RuleUpdate",
});
export type RuleUpdate = typeof RuleUpdate.Type;

/** Something wrong with a rule's export path template. */
export type ExportTemplateProblem =
  | { readonly _tag: "AbsolutePath" }
  | { readonly _tag: "ParentFolder" }
  | { readonly _tag: "UnknownVariable"; readonly name: string };

/**
 * Checks an export path template: it must stay inside the export folder (relative, no `..`
 * folder, no drive letter) and use only built-in variables or the matcher's regex group names.
 */
export const exportTemplateProblems = (
  template: string,
  matcher: Matcher,
): Array<ExportTemplateProblem> => {
  const problems: Array<ExportTemplateProblem> = [];
  if (/^(?:[/\\~]|[A-Za-z]:)/u.test(template)) problems.push({ _tag: "AbsolutePath" });
  if (template.split(/[/\\]/u).some((segment) => segment.trim() === "..")) {
    problems.push({ _tag: "ParentFolder" });
  }
  const known = new Set<string>([...builtInVariables, ...regexGroupNames(matcher)]);
  for (const name of templateVariables(template)) {
    if (!known.has(name)) problems.push({ _tag: "UnknownVariable", name });
  }
  return problems;
};

/** The named groups of a matcher's regex conditions ("series", "episode"). */
const regexGroupNames = (matcher: Matcher): Array<string> =>
  matcher.title.flatMap((condition) =>
    condition._tag === "Regex"
      ? Array.from(
          condition.pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/gu),
          (match) => match[1] ?? "",
        )
      : [],
  );

/** A programme a rule wants recorded, with the padded range to retain. */
export interface RuleMatch {
  readonly rule: Rule;
  readonly programme: Programme;
  readonly range: TimeRange;
  readonly match: MatchResult;
}

/** Matches one rule against one programme. Disabled rules never match. */
export const matchRule = (
  rule: Rule,
  programme: Programme,
  timeZone: string,
): RuleMatch | undefined => {
  if (!rule.enabled) return undefined;
  const match = evaluateMatcher(rule.matcher, programme, timeZone);
  if (match === undefined) return undefined;
  return { rule, programme, range: padRange(programme, rule.padding), match };
};
