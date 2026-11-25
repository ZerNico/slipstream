import type { MergeSuggestionView } from "@slipstream/api";
import type { ReviewSummary } from "@slipstream/domain";
import type { MergeInput } from "./queries.ts";

/** The cards Needs review can show, in order. */
export type CardKind = "merge" | "new" | "gone";

/** Which cards a review has: only those with something left. */
export const reviewCards = (summary: ReviewSummary): CardKind[] => [
  ...(summary.merge > 0 ? (["merge"] as const) : []),
  ...(summary.newStreams > 0 ? (["new"] as const) : []),
  ...(summary.goneStreams > 0 || summary.withoutStreams > 0 ? (["gone"] as const) : []),
];

/** A suggestion as a merge: the first channel stays, the others join it. */
export const mergeOf = (suggestion: MergeSuggestionView): MergeInput | undefined => {
  const [keep, ...others] = suggestion.channels;
  return keep === undefined ? undefined : { keepId: keep.id, otherIds: others.map((c) => c.id) };
};

/** The merges of several suggestions. */
export const mergesOf = (list: readonly MergeSuggestionView[]): MergeInput[] =>
  list.flatMap((suggestion) => mergeOf(suggestion) ?? []);
