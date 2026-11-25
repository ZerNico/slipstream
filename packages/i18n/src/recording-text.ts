import {
  calendarDayOffset,
  type ChainEntry,
  epochMs,
  type Instant,
  localParts,
  type Padding,
  padRange,
  type RecordingState,
  type RerunView,
  scheduledRepeatStart,
} from "@slipstream/domain";
import { formatters, m } from "./runtime.ts";

/*
 * What every client says about recordings and when things happen. Days count in the household
 * zone passed in, never the device's; `now` decides what today is. Clock times use the zone set
 * with `setTimeZone`, which every client sets to that same household zone.
 */

/** Milliseconds as the seconds the formatters take, never negative. */
const seconds = (ms: number) => Math.max(0, ms) / 1000;

/**
 * A day in the pills' notation (decision r3 #11): "Today 22", "Mon 23". Empty while the zone
 * is unknown, so a placeholder can hold the very same box.
 */
export const dayPill = (at: number, now: number, timeZone: string | undefined): string => {
  if (timeZone === undefined) return "";
  const parts = localParts(at, timeZone);
  return m.library_day_pill({
    weekday: parts.weekday,
    day: parts.day,
    today: calendarDayOffset(now, at, timeZone) === 0,
  });
};

/**
 * A day inside a sentence: the pill's notation, with a relative day in lower case ("until
 * today 25", "bis heute 25"), as the copy rules ask.
 */
export const sentenceDay = (at: number, now: number, timeZone: string | undefined): string => {
  const pill = dayPill(at, now, timeZone);
  return timeZone !== undefined && calendarDayOffset(now, at, timeZone) === 0
    ? pill.charAt(0).toLocaleLowerCase() + pill.slice(1)
    : pill;
};

/** When something starts, for a card or a line: "Today 19:25", "Tomorrow 17:00", "Sat 21 17:00". */
export const whenLabel = (at: number, now: number, timeZone: string): string => {
  const start = new Date(at);
  const offset = calendarDayOffset(now, at, timeZone);
  if (offset === 0) return m.when_today({ start });
  if (offset === 1) return m.when_tomorrow({ start });
  return m.when_later({ day: dayPill(at, now, timeZone), start });
};

/** A conflict card's title: "Conflict today at 20:15", "…tomorrow…", or the weekday further out. */
export const conflictTitle = (at: number, now: number, timeZone: string): string => {
  const start = new Date(at);
  const offset = calendarDayOffset(now, at, timeZone);
  if (offset <= 0) return m.home_issue_conflict_today({ start });
  if (offset === 1) return m.home_issue_conflict_tomorrow({ start });
  return m.home_issue_conflict_later({ start });
};

/** What the facts line reads of a recording (`RecordingEntry` in @slipstream/api). */
export interface RecordingFactsSubject {
  readonly state: RecordingState;
  /** The programme's slot; `padding` widens it to what is recorded. */
  readonly start: Instant;
  readonly end: Instant;
  readonly padding: Padding;
  readonly sizeBytes: number;
}

/**
 * The quiet facts of a recording, joined by " · ": when it aired, how long it is and its size
 * ("Sat 21 · 18:00–19:30 · 1 h 40 min · 3.2 GB"). A running recording says how much it has so
 * far ("so far 42 min of 1 h 40 min"); a scheduled one has no size, a failed one neither length
 * nor size. Pass `channel` to lead with the channel's name.
 */
export const recordingFacts = (
  recording: RecordingFactsSubject,
  now: number,
  timeZone: string | undefined,
  channel?: string,
): string => {
  const f = formatters();
  const start = epochMs(recording.start);
  const window = padRange(recording, recording.padding);
  const from = epochMs(window.start);
  const until = epochMs(window.end);
  const length =
    recording.state === "recording"
      ? m.library_length_so_far({
          soFar: f.duration(seconds(Math.min(now, until) - from)),
          of: f.duration(seconds(until - from)),
        })
      : recording.state === "failed"
        ? undefined
        : f.duration(seconds(until - from));
  const day = dayPill(start, now, timeZone);
  return [
    channel === undefined || channel === "" ? undefined : channel,
    day === ""
      ? undefined
      : m.library_aired({ day, start: new Date(start), end: new Date(epochMs(recording.end)) }),
    length,
    recording.state === "scheduled" || recording.state === "failed"
      ? undefined
      : f.size(recording.sizeBytes),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
};

/** What the repeat search's words read from a damaged recording. */
export interface RerunSubject {
  readonly id: ChainEntry["id"];
  readonly rerun?: RerunView | undefined;
  readonly protected: boolean;
}

/**
 * Where the search for the repeat of a damaged series recording stands (recording model §3.7,
 * §9): the repeat it records instead ("Recording the repeat Wed 25, 22:00"), until when it keeps
 * looking, that none was found, or why both copies stay. Nothing when the recording has no
 * search (a manual recording, a good one) or the person stopped it. `entries` lets a listed
 * repeat stand in when the search names none.
 */
export const rerunText = (
  entry: RerunSubject,
  now: number,
  timeZone: string | undefined,
  entries: readonly ChainEntry[] = [],
): string | undefined => {
  const { rerun } = entry;
  if (rerun === undefined) return undefined;
  switch (rerun.state) {
    case "scheduled": {
      const start = scheduledRepeatStart(entry, entries);
      return start === undefined
        ? undefined
        : m.library_rerun_gaps({ day: sentenceDay(start, now, timeZone), start: new Date(start) });
    }
    case "looking":
      return rerun.until === undefined
        ? undefined
        : m.library_rerun_looking({ day: sentenceDay(epochMs(rerun.until), now, timeZone) });
    case "exhausted":
      return m.library_rerun_none();
    case "kept":
      return entry.protected ? m.library_rerun_protected() : m.library_rerun_kept();
    case "declined":
    case "replaced":
      return undefined;
  }
};
