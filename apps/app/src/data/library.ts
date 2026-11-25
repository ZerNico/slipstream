import type { RecordingEntry } from "@slipstream/api";
import {
  type Collection,
  epochMs,
  isPlayable,
  type LibraryGroup,
  libraryGroups,
  padRange,
  type PathLabels,
  type RecordingId,
  renderSegment,
} from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import type { StartAt } from "../player/playback.ts";

/** Which recordings the library shows: everything, or only what the viewer has not watched. */
export type LibraryFilter = "all" | "unwatched";

/** One recording as a library card. Times are epoch ms. */
export interface LibraryCard {
  readonly recordingId: RecordingId;
  readonly channelId: RecordingEntry["channelId"];
  readonly channelName: string;
  /** The big text on the thumbnail: the item of the group path ("Rennen"). */
  readonly label: string;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly running: boolean;
  readonly watched: boolean;
  /** Watched share of the recorded length, 0 to 1; 1 once watched. */
  readonly progress: number;
  /** Seconds left from the saved position, or the whole length before starting. */
  readonly secondsLeft: number;
  /** Where OK starts playback: the saved position when there is one, else the start. */
  readonly from: StartAt;
}

/** One recording as a card: its label, times, watched share and where playback starts. */
export const libraryCard = (
  entry: RecordingEntry,
  names: ReadonlyMap<string, string>,
  labels: PathLabels,
): LibraryCard => {
  const padded = padRange(entry, entry.padding);
  const from = epochMs(padded.start);
  const until = epochMs(padded.end);
  const length = Math.max(1, until - from);
  const position = Math.min(entry.positionMillis, length);
  const resumable = !entry.watched && position > 0;
  return {
    recordingId: entry.id,
    channelId: entry.channelId,
    channelName: names.get(entry.channelId) ?? "",
    label: renderSegment(entry.group.item, labels),
    title: entry.title,
    start: epochMs(entry.start),
    end: epochMs(entry.end),
    running: entry.state === "recording",
    watched: entry.watched,
    progress: entry.watched ? 1 : position / length,
    secondsLeft: Math.round((length - (entry.watched ? 0 : position)) / 1000),
    from: resumable ? "resume" : "start",
  };
};

/** The library on every screen (phone tiles, TV shelves), from the domain's grouping. */
export interface LibraryView {
  /** What records now, newest first: watching from the start is the point. */
  readonly running: readonly RecordingEntry[];
  /** Every place (collections first, then shows by name), its recordings newest first. */
  readonly groups: readonly LibraryGroup<RecordingEntry>[];
  /** How many recordings are scheduled. */
  readonly scheduled: number;
}

/**
 * The library view: the places of everything playable (the domain's `libraryGroups`, the same
 * as the web's), what records now, and the scheduled count. `unwatched` hides what the viewer
 * finished, but never what is still recording.
 */
export const libraryView = (
  all: readonly RecordingEntry[],
  collections: readonly Collection[],
  labels: PathLabels,
  filter: LibraryFilter,
): LibraryView => {
  const shown = all
    .filter(isPlayable)
    .filter((entry) => filter === "all" || !entry.watched || entry.state === "recording");
  return {
    running: shown
      .filter((entry) => entry.state === "recording")
      .toSorted((a, b) => epochMs(b.start) - epochMs(a.start)),
    groups: libraryGroups(shown, collections, labels),
    scheduled: all.filter((entry) => entry.state === "scheduled").length,
  };
};

/** The quiet line under a card: time left (or the slot while recording) and the day. */
export const cardMeta = (card: LibraryCard): string => {
  const day = formatters().day(new Date(card.start));
  if (card.running) {
    return m.recordings_slot({ start: new Date(card.start), end: new Date(card.end) });
  }
  return card.watched
    ? `${m.status_watched()} · ${day}`
    : `${m.recordings_time_left({ seconds: card.secondsLeft })} · ${day}`;
};
