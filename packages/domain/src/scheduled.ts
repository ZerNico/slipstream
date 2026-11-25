import type { RecordingId, SourceId } from "./ids.ts";
import type { RecordingState } from "./recording.ts";
import {
  epochMs,
  HOUR,
  type Instant,
  MINUTE,
  type Padding,
  padRange,
  startOfCalendarDay,
} from "./time.ts";

/*
 * The Scheduled list and its conflict resolution (SPEC §8.4), shared by web, phone and TV:
 * scheduled recordings by household day, every item of an overlap flagged, and under the last
 * item of an overlap the ways out (skip one, end one early) with how much room there is then.
 */

/** What the Scheduled list reads from a recording as the API lists it (`RecordingEntry`). */
export interface ScheduledEntry {
  readonly id: RecordingId;
  readonly state: RecordingState;
  /** The guide's slot. */
  readonly start: Instant;
  readonly end: Instant;
  readonly padding: Padding;
}

/** What the Scheduled list reads from a conflict as the API reports it (`ScheduleConflict`). */
export interface ScheduleOverlap {
  readonly range: { readonly start: Instant; readonly end: Instant };
  readonly recordingIds: readonly RecordingId[];
  readonly sourceIds: readonly SourceId[];
  /** How many recordings the sources can carry at once then (`StreamConflict.capacity`). */
  readonly capacity: number;
}

/** A source and its stream limit, as far as the copy needs it; absent means unlimited. */
export interface OverlapSource {
  readonly id: SourceId;
  readonly maxStreams?: number | undefined;
}

/**
 * How much room a conflict's copy may claim, from the server's own count of free streams for
 * the window (`ScheduleConflict.capacity`):
 * - `limit`: every stream the sources allow is free for recordings then ("only 2 can record at
 *   once");
 * - `free`: fewer than the sources allow, because streams are kept or in use for something
 *   else ("only 1 stream free then");
 * - `unknown`: the count would not explain the conflict (as many streams as recordings), so
 *   the copy names no number rather than a wrong one.
 */
export type ConflictRoom =
  | { readonly kind: "limit"; readonly streams: number }
  | { readonly kind: "free"; readonly streams: number }
  | { readonly kind: "unknown" };

/** The room a conflict's copy states; never as many streams as there are recordings. */
export const conflictRoom = (
  conflict: Pick<ScheduleOverlap, "capacity" | "recordingIds" | "sourceIds">,
  sources: readonly OverlapSource[],
): ConflictRoom => {
  const streams = conflict.capacity;
  if (streams >= conflict.recordingIds.length) return { kind: "unknown" };
  const limits = sources
    .filter((source) => conflict.sourceIds.includes(source.id))
    .map((source) => source.maxStreams);
  const allowed =
    limits.length > 0 && limits.every((limit) => limit !== undefined)
      ? limits.reduce<number>((sum, limit) => sum + (limit ?? 0), 0)
      : undefined;
  return allowed !== undefined && streams < allowed
    ? { kind: "free", streams }
    : { kind: "limit", streams };
};

/** One way out of a conflict: skip a scheduled item, or end a recording early. */
export type ResolveOption<E extends ScheduledEntry = ScheduledEntry> =
  | { readonly kind: "skip"; readonly entry: E }
  | {
      readonly kind: "shorten";
      readonly entry: E;
      /** When it would end instead: the start of the overlap. */
      readonly endAt: number;
      /** Extra minutes after the programme it keeps, of how many. */
      readonly keepsAfter: number;
      readonly ofAfter: number;
    };

/** The resolution under the last item of an overlap (SPEC §8.4). */
export interface Resolution<E extends ScheduledEntry = ScheduledEntry> {
  readonly from: number;
  readonly to: number;
  /** How many can record then, as the copy may state it. */
  readonly room: ConflictRoom;
  readonly count: number;
  readonly options: readonly ResolveOption<E>[];
}

/** One scheduled row: flagged when it is part of an overlap. */
export interface ScheduledRow<E extends ScheduledEntry = ScheduledEntry> {
  readonly entry: E;
  readonly conflict: boolean;
  readonly resolution: Resolution<E> | undefined;
}

/** A day of the Scheduled list. `day` is the start of that household day, epoch ms. */
export interface ScheduledDay<E extends ScheduledEntry = ScheduledEntry> {
  readonly day: number;
  /**
   * An instant well inside the day (12 hours after its start), epoch ms: what its label is
   * written from. A day's very first instant sits on the boundary, where a JS engine's zone
   * data (Hermes on Android) can name the day before.
   */
  readonly midday: number;
  readonly rows: readonly ScheduledRow<E>[];
}

/** The settings a shortened recording keeps: its extra minutes after cut to the overlap. */
export const shortenedPadding = (option: Extract<ResolveOption, { kind: "shorten" }>): Padding => ({
  ...option.entry.padding,
  afterMinutes: option.keepsAfter,
});

/**
 * Ways out of one conflict: every scheduled item can be skipped; a recording whose programme
 * ends before the overlap starts can end early instead, giving up only extra minutes.
 */
export const resolveOptions = <E extends ScheduledEntry>(
  conflict: Pick<ScheduleOverlap, "range" | "recordingIds">,
  entries: readonly E[],
): readonly ResolveOption<E>[] => {
  const from = epochMs(conflict.range.start);
  const involved = entries
    .filter((entry) => conflict.recordingIds.includes(entry.id))
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
  const options = involved.flatMap((entry): ResolveOption<E>[] => {
    const programmeEnd = epochMs(entry.end);
    if (programmeEnd <= from && epochMs(padRange(entry, entry.padding).end) > from) {
      return [
        {
          kind: "shorten",
          entry,
          endAt: from,
          keepsAfter: Math.floor((from - programmeEnd) / MINUTE),
          ofAfter: entry.padding.afterMinutes,
        },
      ];
    }
    return entry.state === "scheduled" ? [{ kind: "skip", entry }] : [];
  });
  // Skipping comes first: it costs one item; shortening trims a recording people may watch.
  return [
    ...options.filter((option) => option.kind === "skip"),
    ...options.filter((option) => option.kind === "shorten"),
  ];
};

/**
 * The Scheduled list: scheduled recordings by household day (`timeZone`, the days the guide
 * shows; a DST change makes a day 23 or 25 hours long) in start order. Every item of an overlap
 * is flagged; the resolution sits under the last one of it in the list.
 */
export const scheduledDays = <E extends ScheduledEntry>(
  entries: readonly E[],
  conflicts: readonly ScheduleOverlap[],
  sources: readonly OverlapSource[],
  timeZone: string,
): readonly ScheduledDay<E>[] => {
  const scheduled = entries
    .filter((entry) => entry.state === "scheduled")
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
  const resolutions = new Map<string, Resolution<E>>();
  for (const conflict of conflicts) {
    const last = scheduled.findLast((entry) => conflict.recordingIds.includes(entry.id));
    if (last === undefined || resolutions.has(last.id)) continue;
    resolutions.set(last.id, {
      from: epochMs(conflict.range.start),
      to: epochMs(conflict.range.end),
      count: conflict.recordingIds.length,
      room: conflictRoom(conflict, sources),
      options: resolveOptions(conflict, entries),
    });
  }
  const flagged = new Set<string>(conflicts.flatMap((conflict) => conflict.recordingIds));
  const days = new Map<number, ScheduledRow<E>[]>();
  for (const entry of scheduled) {
    const day = epochMs(startOfCalendarDay(entry.start, timeZone));
    const rows = days.get(day) ?? [];
    rows.push({ entry, conflict: flagged.has(entry.id), resolution: resolutions.get(entry.id) });
    days.set(day, rows);
  }
  return [...days.entries()].map(([day, rows]) => ({ day, midday: day + 12 * HOUR, rows }));
};
