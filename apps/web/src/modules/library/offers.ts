import {
  type Collection,
  type CollectionOffer,
  collectionOffer,
  type GroupingContext,
  type Rule,
} from "@slipstream/domain";
import type { Entry } from "./library.ts";

/*
 * The offer under Recordings › Collections (SPEC §7.5, recording model §3.3): a series recording
 * whose recordings scatter over several places is offered one collection that follows it.
 */

/** A series recording whose recordings scatter, with the offer to group them. */
export interface SeriesOffer {
  readonly rule: Rule;
  readonly offer: CollectionOffer;
}

/**
 * Series recordings to offer a collection for: no collection yet, the offer not declined, and
 * at least two of its recordings (made or scheduled) in different places, one of them grouped
 * by title and date (`collectionOffer`). In the rules' order.
 */
export const seriesOffers = (
  rules: readonly Rule[],
  entries: readonly Entry[],
  collections: readonly Collection[],
  context: GroupingContext,
): readonly SeriesOffer[] =>
  rules.flatMap((rule): SeriesOffer[] => {
    if (rule.collectionId !== undefined || rule.offerDeclined) return [];
    const items = entries.filter(
      (entry) =>
        entry.ruleId === rule.id && entry.state !== "cancelled" && entry.state !== "failed",
    );
    if (items.length < 2) return [];
    const offer = collectionOffer(items, { ...context, collections });
    return offer === undefined ? [] : [{ rule, offer }];
  });
