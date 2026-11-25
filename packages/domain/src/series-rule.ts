import { type EpisodeContext, episodeIdentity, type EpisodeSubject } from "./episode.ts";
import type { ChannelId, CollectionId } from "./ids.ts";
import { emptyMatcher, type Matcher } from "./matcher.ts";
import type { Programme } from "./programme.ts";
import type { RecordEveryKind } from "./record-options.ts";
import type { RuleDraft } from "./rule.ts";
import { cleanTitle } from "./title.ts";
import { titleStart } from "./suggestions.ts";
import { seriesDisplayName } from "./title.ts";
import type { Padding } from "./time.ts";

/*
 * "Record every…": what kind of row a programme gets, the title start it keys on and the rule it
 * makes, the same on the web, the phone and the TV.
 */

/**
 * The kind of the programme sheet's second record row, derived from `episodeIdentity` so the
 * two never disagree: an Episode is a series, an Event or Broadcast is "every broadcast", and a
 * Film airs again rather than continues, so it gets no row.
 */
export const recordEveryKind = (
  programme: EpisodeSubject,
  context: EpisodeContext,
): RecordEveryKind => {
  switch (episodeIdentity(programme, context)._tag) {
    case "Episode":
      return "series";
    case "Event":
    case "Broadcast":
      return "broadcasts";
    case "Film":
      return "none";
  }
};

/** The title start "Record every…" matches, and how to phrase it. */
export interface SeriesPrefix {
  /** What the rule's "starts with" condition holds: "Live F1:", "Tatort". */
  readonly prefix: string;
  /** True when the prefix is a start of a longer title ("Every session titled Live F1: …"). */
  readonly partial: boolean;
  /**
   * The name a series recording or collection made from it gets: the prefix as
   * `seriesDisplayName` writes it ("Live F1", "Der Pate").
   */
  readonly name: string;
}

/**
 * The start of a title a rule or collection keys on: up to the first separator ("Live F1:" of
 * "Live F1: Rennen - GP Las Vegas"), else the whole cleaned title ("Tatort", "Der Pate").
 */
export const seriesPrefix = (title: string): SeriesPrefix => {
  const start = titleStart(title);
  if (start === undefined) {
    const whole = cleanTitle(title) || title.trim();
    return { prefix: whole, partial: false, name: seriesDisplayName(whole) };
  }
  return { prefix: start.prefix, partial: true, name: seriesDisplayName(start.prefix) };
};

/**
 * What "Record every…" matches: titles starting with the programme's prefix (`seriesPrefix`),
 * on its channel, or on any channel when there is none.
 */
export const seriesMatcher = (programme: {
  readonly channelId?: ChannelId | undefined;
  readonly title: string;
}): Matcher => ({
  ...emptyMatcher,
  channels: programme.channelId === undefined ? [] : [programme.channelId],
  title: [{ _tag: "StartsWith", values: [seriesPrefix(programme.title).prefix] }],
});

/**
 * The rule "Record every…" creates on the web and the TV: this channel, titles starting with the
 * prefix, keeping everything, only episodes the owner does not have yet, with the chosen extra
 * time and optionally a collection.
 */
export const seriesRule = (
  programme: Pick<Programme, "channelId" | "title">,
  padding: Padding,
  collectionId?: CollectionId,
): RuleDraft => {
  return {
    // Named without the colon its condition keeps: "Live F1", matching "Live F1: …".
    name: seriesPrefix(programme.title).name,
    enabled: true,
    matcher: seriesMatcher(programme),
    padding,
    retention: { _tag: "KeepAll" },
    skipRepeats: true,
    ...(collectionId === undefined ? {} : { collectionId }),
  };
};
