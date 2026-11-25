import { Schema } from "effect";
import { type Collection, type CollectionSubject, matchCollection } from "./collection.ts";
import { CollectionId, RuleId } from "./ids.ts";
import { extractParts, prepareTitle } from "./parts.ts";
import { chainOf, type RecordingState, type Retention } from "./recording.ts";
import type { RerunState } from "./rerun.ts";
import { normaliseText } from "./title.ts";
import { DAY, epochMs, type Instant } from "./time.ts";

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** Why retention deletes a recording; the UI phrases it ("beyond the newest 5"). */
export const RetentionReason = Schema.TaggedUnion({
  BeyondNewest: { count: PositiveInt },
  BeyondNewestEvents: { count: PositiveInt, event: Schema.String },
  OlderThan: { days: PositiveInt },
}).annotate({ identifier: "RetentionReason" });
export type RetentionReason = typeof RetentionReason.Type;

/**
 * Why a recording stays: `protected` by hand, `active` (scheduled or still recording),
 * `rerun` (its chain still looks for or has scheduled a repeat), `hidden` (replaced or deleted,
 * purged on its own schedule and never counted), `keepAll` policy, `withinPolicy`, or `noEvent`
 * (newest-events policy, but the title has no event part, so retention cannot tell which event
 * it belongs to and leaves it alone).
 */
export type KeepReason =
  | "protected"
  | "active"
  | "rerun"
  | "hidden"
  | "keepAll"
  | "withinPolicy"
  | "noEvent";

/** What retention reads from a recording. */
export interface RetentionItem {
  readonly start: Instant;
  readonly end: Instant;
  readonly state: RecordingState;
  readonly protected: boolean;
  /** The event part of the title (e.g. "GP Las Vegas"), for `KeepNewestEvents`. */
  readonly event?: string | undefined;
  /** Its id; with `replacesId` it ties a damaged original and its repeats into one chain. */
  readonly id?: string | undefined;
  /** The chain's original, set on a repeat recorded to replace it. */
  readonly replacesId?: string | undefined;
  /** Hidden (replaced, or deleted while its chain runs): never counted, never removed here. */
  readonly hiddenAt?: Instant | undefined;
  /** The chain's rerun state (`rerunState` of its original), when it has one. */
  readonly rerun?: RerunState | undefined;
}

/** The outcome for every item: what to delete and why, and why the rest stays. */
export interface RetentionVerdict<A> {
  readonly remove: ReadonlyArray<{ readonly item: A; readonly reason: RetentionReason }>;
  readonly keep: ReadonlyArray<{ readonly item: A; readonly reason: KeepReason }>;
}

const newestFirst = <A extends RetentionItem>(a: A, b: A): number =>
  epochMs(b.start) - epochMs(a.start);
const eventKey = (event: string | undefined): string | undefined => {
  const key = event === undefined ? "" : normaliseText(event).toLowerCase();
  return key === "" ? undefined : key;
};

/**
 * Applies one retention policy to the recordings it governs (one rule or one collection).
 * Protected recordings are never deleted and take no slot. Scheduled and running ones are never
 * deleted either; running ones take a slot, since they are about to be the newest. Days count
 * from the end of the recording, up to `now` (epoch ms). Each item appears exactly once in the
 * result, input order kept.
 */
export const applyRetention = <A extends RetentionItem>(
  policy: Retention,
  items: ReadonlyArray<A>,
  now: number,
): RetentionVerdict<A> => {
  const removed = new Map<A, RetentionReason>();
  const kept = new Map<A, KeepReason>();
  const counted: Array<A> = [];
  const runningChains = new Set(
    items.flatMap((item) => {
      const chain = chainOf(item);
      return chain !== undefined && (item.rerun === "looking" || item.rerun === "scheduled")
        ? [chain]
        : [];
    }),
  );
  for (const item of items) {
    const chain = chainOf(item);
    if (item.hiddenAt !== undefined) kept.set(item, "hidden");
    else if (item.protected) kept.set(item, "protected");
    else if (item.state === "scheduled") kept.set(item, "active");
    else {
      if (item.state === "recording") kept.set(item, "active");
      else if (chain !== undefined && runningChains.has(chain)) kept.set(item, "rerun");
      counted.push(item);
    }
  }
  const deletable = (item: A): boolean => !kept.has(item);

  switch (policy._tag) {
    case "KeepAll":
      break;
    case "KeepNewest": {
      // One slot per episode: the members of a chain share the slot of the newest of them.
      const slots = new Map<string, number>();
      counted.toSorted(newestFirst).forEach((item, index) => {
        const chain = chainOf(item) ?? `item:${index}`;
        const slot = slots.get(chain) ?? slots.size;
        slots.set(chain, slot);
        if (slot >= policy.count && deletable(item)) {
          removed.set(item, { _tag: "BeyondNewest", count: policy.count });
        }
      });
      break;
    }
    case "KeepNewestEvents": {
      const newestByEvent = new Map<string, { readonly start: number; readonly event: string }>();
      for (const item of counted) {
        const key = eventKey(item.event);
        if (key === undefined) continue;
        const previous = newestByEvent.get(key);
        if (previous === undefined || epochMs(item.start) > previous.start) {
          newestByEvent.set(key, {
            start: epochMs(item.start),
            event: normaliseText(item.event ?? ""),
          });
        }
      }
      const keptEvents = new Set(
        [...newestByEvent.entries()]
          .toSorted(([, a], [, b]) => b.start - a.start)
          .slice(0, policy.count)
          .map(([key]) => key),
      );
      for (const item of counted) {
        const key = eventKey(item.event);
        if (key === undefined) {
          if (deletable(item)) kept.set(item, "noEvent");
        } else if (!keptEvents.has(key) && deletable(item)) {
          removed.set(item, {
            _tag: "BeyondNewestEvents",
            count: policy.count,
            event: newestByEvent.get(key)?.event ?? key,
          });
        }
      }
      break;
    }
    case "KeepDays": {
      const cutoff = now - policy.days * DAY;
      for (const item of counted) {
        if (epochMs(item.end) < cutoff && deletable(item)) {
          removed.set(item, { _tag: "OlderThan", days: policy.days });
        }
      }
      break;
    }
  }

  const fallback: KeepReason = policy._tag === "KeepAll" ? "keepAll" : "withinPolicy";
  const remove: Array<{ readonly item: A; readonly reason: RetentionReason }> = [];
  const keep: Array<{ readonly item: A; readonly reason: KeepReason }> = [];
  for (const item of items) {
    const reason = removed.get(item);
    if (reason === undefined) keep.push({ item, reason: kept.get(item) ?? fallback });
    else remove.push({ item, reason });
  }
  return { remove, keep };
};

/** Whose retention policy applies to a recording: its collection's or its rule's. */
export const RetentionPolicyFrom = Schema.TaggedUnion({
  Collection: { collectionId: CollectionId },
  Rule: { ruleId: RuleId },
});
export type RetentionPolicyFrom = typeof RetentionPolicyFrom.Type;

/**
 * The policy that governs a recording and whose it is: its collection's, when the collection
 * sets one (the library is organised by collection), otherwise its rule's. None without either:
 * the recording is kept.
 */
export const governingRetention = (
  collection: { readonly id: CollectionId; readonly retention?: Retention | undefined } | undefined,
  rule: { readonly id: RuleId; readonly retention: Retention } | undefined,
): { readonly retention: Retention; readonly from: RetentionPolicyFrom } | undefined => {
  if (collection?.retention !== undefined) {
    return {
      retention: collection.retention,
      from: { _tag: "Collection", collectionId: collection.id },
    };
  }
  return rule === undefined
    ? undefined
    : { retention: rule.retention, from: { _tag: "Rule", ruleId: rule.id } };
};

/** The name of the title part `KeepNewestEvents` groups by, compared case-insensitively. */
const eventPartName = "event";

/**
 * The event a recording belongs to inside a collection: its Event part ("GP Las Vegas"), or
 * `undefined` when the collection has no such part, does not match, or the title cannot be split.
 */
export const eventOf = (
  collection: Collection,
  subject: CollectionSubject,
  timeZone: string,
): string | undefined => {
  const name = collection.layout.parts.find(
    (part) => part.name.toLowerCase() === eventPartName,
  )?.name;
  if (name === undefined) return undefined;
  const match = matchCollection(collection, subject, timeZone);
  if (match === undefined) return undefined;
  return extractParts(collection.layout.parts, prepareTitle(subject.title, match.titleHits))[name];
};
