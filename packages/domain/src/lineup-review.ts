import type { MatchReason } from "./channel-match.ts";
import type { ChannelId, SourceId, SourceStreamId } from "./ids.ts";

/*
 * "Needs review" on Settings › Sources & channels (web and phone), as plain data: what the cards
 * or rows say, the merge suggestions by confidence, the channels a dropped stream touched, and
 * what adding a found stream to a channel does. The types are the API's review, structurally.
 */

/** A channel by id and name. */
export interface ReviewChannelRef {
  readonly id: ChannelId;
  readonly name: string;
}

/** Channels that look like one channel; the first is the one to keep. */
export interface ReviewSuggestion {
  readonly channels: ReadonlyArray<
    ReviewChannelRef & {
      readonly streams: ReadonlyArray<{ readonly name: string; readonly sourceName: string }>;
    }
  >;
  readonly reason: MatchReason;
}

/** What needs an admin's eye in the lineup (the API's `ChannelReview`). */
export interface LineupReview<S extends ReviewSuggestion = ReviewSuggestion> {
  readonly mergeSuggestions: ReadonlyArray<S>;
  readonly sources: ReadonlyArray<{
    readonly sourceId: SourceId;
    readonly name: string;
    readonly newStreams: number;
    readonly goneStreams: number;
  }>;
  readonly goneStreams: ReadonlyArray<{
    readonly sourceStreamId: SourceStreamId;
    readonly sourceId: SourceId;
    readonly name: string;
    readonly channel: ReviewChannelRef;
    readonly playsFrom?: string | undefined;
  }>;
  readonly withoutStreams: ReadonlyArray<ReviewChannelRef>;
}

/** What the Needs review cards count; a card shows only when its count is above zero. */
export interface ReviewSummary {
  /** Merge suggestions. */
  readonly merge: number;
  /** Sources named in the suggestions' streams. */
  readonly mergeSources: number;
  readonly newStreams: number;
  /** The sources with new streams, in the review's order. */
  readonly newSources: ReadonlyArray<{ readonly id: SourceId; readonly name: string }>;
  readonly goneStreams: number;
  /** The sources streams are gone from. */
  readonly goneSources: ReadonlyArray<string>;
  /** Channels with no stream left: the only part that counts as a problem. */
  readonly withoutStreams: number;
}

/** Counts a review for the cards. */
export const reviewSummary = (review: LineupReview): ReviewSummary => {
  const mergeSources = new Set(
    review.mergeSuggestions.flatMap((suggestion) =>
      suggestion.channels.flatMap((channel) => channel.streams.map((stream) => stream.sourceName)),
    ),
  );
  const fresh = review.sources.filter((source) => source.newStreams > 0);
  return {
    merge: review.mergeSuggestions.length,
    mergeSources: mergeSources.size,
    newStreams: fresh.reduce((sum, source) => sum + source.newStreams, 0),
    newSources: fresh.map((source) => ({ id: source.sourceId, name: source.name })),
    goneStreams: review.goneStreams.length,
    goneSources: review.sources
      .filter((source) => review.goneStreams.some((gone) => gone.sourceId === source.sourceId))
      .map((source) => source.name),
    withoutStreams: review.withoutStreams.length,
  };
};

/** Whether anything is left to review. */
export const hasReview = (summary: ReviewSummary): boolean =>
  summary.merge > 0 ||
  summary.newStreams > 0 ||
  summary.goneStreams > 0 ||
  summary.withoutStreams > 0;

/** Suggestions in two groups by confidence, same guide channel first; empty groups left out. */
export const suggestionGroups = <S extends ReviewSuggestion>(
  suggestions: ReadonlyArray<S>,
): ReadonlyArray<{ readonly reason: MatchReason; readonly suggestions: ReadonlyArray<S> }> =>
  (["sameGuide", "similarName"] as const)
    .map((reason) => ({
      reason,
      suggestions: suggestions.filter((suggestion) => suggestion.reason === reason),
    }))
    .filter((group) => group.suggestions.length > 0);

/** A suggestion's key: its channels' ids. */
export const suggestionKey = (suggestion: ReviewSuggestion): string =>
  suggestion.channels.map((channel) => channel.id).join("+");

/** One channel a gone stream belonged to, or one with no stream at all. */
export interface GoneChannel {
  readonly channel: ReviewChannelRef;
  /** The stream names its playlist dropped. */
  readonly gone: ReadonlyArray<string>;
  /** Nothing left to play. */
  readonly noStream: boolean;
  /** The source it still plays from. */
  readonly playsFrom: string | undefined;
}

/** The channels to look at after streams went: those with no stream left first. */
export const goneChannels = (review: LineupReview): ReadonlyArray<GoneChannel> => {
  const without = new Set<string>(review.withoutStreams.map((channel) => channel.id));
  const byId = new Map<string, GoneChannel>();
  for (const stream of review.goneStreams) {
    const known = byId.get(stream.channel.id);
    byId.set(stream.channel.id, {
      channel: stream.channel,
      gone: [...(known?.gone ?? []), stream.name],
      noStream: without.has(stream.channel.id),
      playsFrom: known?.playsFrom ?? stream.playsFrom,
    });
  }
  for (const channel of review.withoutStreams) {
    if (!byId.has(channel.id)) {
      byId.set(channel.id, { channel, gone: [], noStream: true, playsFrom: undefined });
    }
  }
  const list = [...byId.values()];
  return [...list.filter((entry) => entry.noStream), ...list.filter((entry) => !entry.noStream)];
};

/** A source's stream as the add-stream picker lists it: which source, and where it is now. */
export interface FoundStream {
  readonly id: SourceStreamId;
  readonly name: string;
  readonly sourceId: SourceId;
  readonly sourceName: string;
  readonly group: string | undefined;
  /** The channel it is on, if any. */
  readonly channel: ReviewChannelRef | undefined;
}

/** What adding a found stream to `channelId` does: add it, move it here, or nothing. */
export const addKind = (
  stream: Pick<FoundStream, "channel">,
  channelId: ChannelId,
): "add" | "move" | "here" =>
  stream.channel === undefined ? "add" : stream.channel.id === channelId ? "here" : "move";
