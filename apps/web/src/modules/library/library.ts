import type { RecordingEntry } from "@slipstream/api";
import {
  calendarDayNumber,
  type Channel,
  type Collection,
  epochMs,
  isRecorded,
  padRange,
  type PathLabels,
  recordingGapSummary,
  renderPath,
  type UserId,
} from "@slipstream/domain";
import type { TimelineData, TimeSpan } from "@slipstream/domain";

/** A recording as the library lists it. */
export type Entry = RecordingEntry;

/** The guide's slot. */
export const programmeSpan = (entry: Entry): TimeSpan => ({
  start: epochMs(entry.start),
  end: epochMs(entry.end),
});

/** The slot with the extra minutes before and after: what is actually recorded. */
export const recordedSpan = (entry: Entry): TimeSpan => {
  const range = padRange(entry, entry.padding);
  return { start: epochMs(range.start), end: epochMs(range.end) };
};

/**
 * The stretches missing from a recording, as every client reads them (`recordingGapSummary`:
 * gaps, an unreachable source and every stream busy, merged and clipped to the padded window).
 * While it records, a stretch ends at now: nothing later has been missed yet.
 */
export const gapsOf = (entry: Entry, now: number): readonly TimeSpan[] => {
  const until = entry.state === "recording" ? now : Number.POSITIVE_INFINITY;
  return recordingGapSummary(entry).gaps.flatMap(({ range }) => {
    const start = epochMs(range.start);
    const end = Math.min(epochMs(range.end), until);
    return end > start ? [{ start, end }] : [];
  });
};

/** Milliseconds missing from a recording so far (`gapsOf`, overlaps already merged). */
export const missingMillis = (entry: Entry, now: number): number =>
  gapsOf(entry, now).reduce((sum, gap) => sum + gap.end - gap.start, 0);

/** What has been captured so far: up to now while recording, all of it once finished. */
export const capturedSpan = (entry: Entry, now: number): TimeSpan | undefined => {
  const span = recordedSpan(entry);
  if (entry.state === "recording") return { start: span.start, end: Math.min(now, span.end) };
  if (isRecorded(entry)) return span;
  return undefined;
};

/** The resume position (ms from the recorded start) the reader left at, if any. */
export const resumeMillis = (entry: Entry): number | undefined =>
  entry.watched || entry.positionMillis <= 0 ? undefined : entry.positionMillis;

/** A recording as a timeline: padding included, programme ticks, live while it records. */
export const recordingTimeline = (entry: Entry, now: number, position?: number): TimelineData => {
  const span = recordedSpan(entry);
  const programme = programmeSpan(entry);
  const captured = capturedSpan(entry, now);
  return {
    start: span.start,
    end: span.end,
    ...(captured ? { captured } : {}),
    gaps: gapsOf(entry, now),
    marks: [programme.start, programme.end],
    ...(position === undefined ? {} : { playhead: span.start + position }),
    ...(entry.state === "recording" ? { live: Math.min(now, span.end) } : {}),
  };
};

/** How the library groups: by collection path, by channel, or by the day it aired. */
export type LibraryView = "collections" | "channel" | "date";

/** Which recordings the library shows: all, the ones the reader has not finished, or theirs. */
export type LibraryFilter = "all" | "unwatched" | "mine";

/** A heading in the library and the recordings under it, oldest first. */
export interface RecordingGroup {
  readonly key: string;
  /** The path above the title, "Formel 1 › 2026". Empty outside the collections view. */
  readonly crumbs: readonly string[];
  readonly title: string;
  /** The collection that put these here, in the collections view. */
  readonly collection: string | undefined;
  readonly items: readonly Entry[];
  readonly sizeBytes: number;
}

/** What grouping needs to name things. */
export interface LibraryContext {
  readonly labels: PathLabels;
  readonly channels: readonly Channel[];
  readonly collections: readonly Collection[];
  readonly day: (epochMs: number) => string;
  /**
   * The household's zone, the one the By date view counts days in; undefined until the server
   * answered, while the view is a skeleton (one placeholder day).
   */
  readonly timeZone: string | undefined;
}

/** The text a recording is found by: title, sub-title, channel and its group path. */
const searchText = (entry: Entry, context: LibraryContext): string =>
  [
    entry.title,
    entry.subtitle ?? "",
    context.channels.find((channel) => channel.id === entry.channelId)?.name ?? "",
    ...renderPath(entry.group, context.labels),
  ]
    .join(" ")
    .toLocaleLowerCase();

/** Recordings that pass the filter and contain every word of the search, in any order. */
export const filterRecordings = (
  entries: readonly Entry[],
  options: {
    readonly filter: LibraryFilter;
    readonly query: string;
    readonly user: UserId;
    readonly context: LibraryContext;
  },
): readonly Entry[] => {
  const words = options.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return entries.filter((entry) => {
    if (options.filter === "mine" && !entry.ownerIds.includes(options.user)) return false;
    if (options.filter === "unwatched" && entry.watched) return false;
    if (words.length === 0) return true;
    const haystack = searchText(entry, options.context);
    return words.every((word) => haystack.includes(word));
  });
};

/** The household day a moment falls on, as a group key. */
const dayKey = (millis: number, timeZone: string | undefined) =>
  timeZone === undefined ? "day" : `day-${calendarDayNumber(millis, timeZone)}`;

/**
 * The library's headings for a view. In "Collections & shows" a recording sits under its
 * group path's folders and is named by its item; collections come first, then series, then
 * everything else, each by name. Channels sort by number; days newest first, because the
 * newest recordings are what people come back for.
 */
export const groupRecordings = (
  entries: readonly Entry[],
  view: LibraryView,
  context: LibraryContext,
): readonly RecordingGroup[] => {
  const groups = new Map<
    string,
    { group: Omit<RecordingGroup, "items" | "sizeBytes">; items: Entry[]; order: string }
  >();
  for (const entry of entries) {
    let group: Omit<RecordingGroup, "items" | "sizeBytes">;
    let order: string;
    if (view === "collections") {
      const folders = renderPath(entry.group, context.labels).slice(0, -1);
      const collection = context.collections.find(
        (candidate) => candidate.id === entry.group.collectionId,
      );
      group = {
        key: folders.join("\u0000"),
        crumbs: folders.slice(0, -1),
        title: folders.at(-1) ?? entry.title,
        collection: collection?.name,
      };
      order = `${entry.group.source === "collection" ? 0 : 1}${folders.join("\u0000")}`;
    } else if (view === "channel") {
      const channel = context.channels.find((candidate) => candidate.id === entry.channelId);
      group = {
        key: entry.channelId,
        crumbs: [],
        title: channel?.name ?? entry.channelId,
        collection: undefined,
      };
      order = String(channel?.number ?? Number.MAX_SAFE_INTEGER).padStart(16, "0");
    } else {
      const start = epochMs(entry.start);
      group = {
        key: dayKey(start, context.timeZone),
        crumbs: [],
        title: context.day(start),
        collection: undefined,
      };
      // Newest first: invert the sortable key.
      order = String(Number.MAX_SAFE_INTEGER - start).padStart(16, "0");
    }
    const existing = groups.get(group.key);
    if (existing) existing.items.push(entry);
    else groups.set(group.key, { group, items: [entry], order });
  }
  return [...groups.values()]
    .toSorted((a, b) => a.order.localeCompare(b.order))
    .map(({ group, items }) => ({
      ...group,
      items: items.toSorted((a, b) => epochMs(a.start) - epochMs(b.start)),
      sizeBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    }));
};

/** The item's own name inside its group, "Rennen" under "Formel 1 › 2026 › GP Las Vegas". */
export const itemName = (entry: Entry, labels: PathLabels): string =>
  renderPath(entry.group, labels).at(-1) ?? entry.title;
