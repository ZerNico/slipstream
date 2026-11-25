import type { RecordingEntry } from "@slipstream/api";
import { epochMs, isPlayable, type Programme } from "@slipstream/domain";
import { formatters, m, pathLabels, recordingFacts } from "@slipstream/i18n";
import { householdZone } from "../data/zone.ts";
import { cardMeta, libraryCard } from "../data/library.ts";

/*
 * The quiet line under a search result, in the words the rest of the app uses: a programme on
 * now says its channel and slot, a later one its channel and when (the web palette's line); a
 * recording says what its library card or its page says.
 */

/** The line under a programme result. */
export const programmeMeta = (programme: Programme, channelName: string, now: number): string => {
  const start = epochMs(programme.start);
  if (start > now) return m.palette_guide_meta({ channel: channelName, start: new Date(start) });
  const slot = formatters().timeRange(new Date(start), new Date(epochMs(programme.end)));
  return channelName === "" ? slot : `${channelName} · ${slot}`;
};

/** A recording result's watched share (0 to 1, 0 once watched) and its line. */
export const recordingText = (
  entry: RecordingEntry,
  names: ReadonlyMap<string, string>,
  now: number,
): { readonly progress: number; readonly meta: string } => {
  if (!isPlayable(entry)) {
    return {
      progress: 0,
      meta: recordingFacts(entry, now, householdZone(), names.get(entry.channelId)),
    };
  }
  const card = libraryCard(entry, names, pathLabels());
  return { progress: card.progress < 1 ? card.progress : 0, meta: cardMeta(card) };
};
