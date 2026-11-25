import { DateTime, Schema } from "effect";

/** A point in time. ISO 8601 on the wire, `DateTime.Utc` in code. */
export const Instant = Schema.DateTimeUtcFromString;
export type Instant = DateTime.Utc;

/** A half-open time range `[start, end)`. */
export const TimeRange = Schema.Struct({ start: Instant, end: Instant }).annotate({
  identifier: "TimeRange",
});
export type TimeRange = typeof TimeRange.Type;

const Minutes = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 24 * 60 }));

/** Extra minutes recorded before the start ("start early") and after the end ("keep after"). */
export const Padding = Schema.Struct({ beforeMinutes: Minutes, afterMinutes: Minutes }).annotate({
  identifier: "Padding",
});
export type Padding = typeof Padding.Type;

/** No extra time on either side. */
export const noPadding: Padding = { beforeMinutes: 0, afterMinutes: 0 };

/**
 * The extra-time steppers' bounds in minutes, the one UI maximum every client uses. The schema
 * accepts up to a day so stored data stays valid; the steppers never offer more than this.
 */
export const paddingLimits = { min: 0, max: 240 } as const;

/** Rounds a stepper value to whole minutes inside {@link paddingLimits}. */
export const clampPaddingMinutes = (minutes: number): number =>
  Number.isFinite(minutes)
    ? Math.min(paddingLimits.max, Math.max(paddingLimits.min, Math.round(minutes)))
    : paddingLimits.min;

/** How much one "Extend" adds to a running recording's extra time after, in minutes. */
export const extendStepMinutes = 30;

/**
 * A padding extended once: `extendStepMinutes` more after the end, held at
 * `paddingLimits.max` (via `clampPaddingMinutes`). The time before stays as it is.
 */
export const extendPadding = (padding: Padding): Padding => ({
  beforeMinutes: padding.beforeMinutes,
  afterMinutes: clampPaddingMinutes(padding.afterMinutes + extendStepMinutes),
});

/** The values a D-pad stepper walks through, fine near zero and coarse towards four hours. */
export const paddingStepMinutes: ReadonlyArray<number> = [
  0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240,
];

/**
 * The next stepper value up (`1`) or down (`-1`) from `current`, held at the ends. A value
 * between two steps (typed on the web, or a channel default) moves to the neighbouring step.
 */
export const stepPaddingMinutes = (current: number, direction: 1 | -1): number => {
  const value = clampPaddingMinutes(current);
  const next =
    direction === 1
      ? paddingStepMinutes.find((step) => step > value)
      : paddingStepMinutes.findLast((step) => step < value);
  return next ?? value;
};

/** True when both sides of the two paddings are equal. */
export const paddingEquals = (a: Padding, b: Padding): boolean =>
  a.beforeMinutes === b.beforeMinutes && a.afterMinutes === b.afterMinutes;

/** A minute in milliseconds. */
export const MINUTE = 60_000;
/** An hour in milliseconds. */
export const HOUR = 60 * MINUTE;
/** A day of 24 hours in milliseconds (not a calendar day across a DST change). */
export const DAY = 24 * HOUR;

/** Milliseconds since the Unix epoch, the one way every package turns an instant into a number. */
export const epochMs: (instant: Instant) => number = DateTime.toEpochMillis;

const at = (millis: number): Instant => DateTime.makeUnsafe(millis);

/** Length of a range in milliseconds. */
export const durationMillis = (range: TimeRange): number =>
  epochMs(range.end) - epochMs(range.start);

/** Widens a range by the padding: `start - before`, `end + after`. */
export const padRange = (range: TimeRange, padding: Padding): TimeRange => ({
  start: at(epochMs(range.start) - padding.beforeMinutes * MINUTE),
  end: at(epochMs(range.end) + padding.afterMinutes * MINUTE),
});

/** True when the two half-open ranges share at least one instant. Touching ranges do not. */
export const overlaps = (a: TimeRange, b: TimeRange): boolean =>
  epochMs(a.start) < epochMs(b.end) && epochMs(b.start) < epochMs(a.end);

/** The smallest range covering all the given ranges (gaps between them included). */
export const span = (first: TimeRange, ...rest: ReadonlyArray<TimeRange>): TimeRange =>
  rest.reduce<TimeRange>(
    (acc, range) => ({
      start: epochMs(range.start) < epochMs(acc.start) ? range.start : acc.start,
      end: epochMs(range.end) > epochMs(acc.end) ? range.end : acc.end,
    }),
    first,
  );

/** The shared part of two ranges, or `undefined` when they do not overlap. */
export const intersection = (a: TimeRange, b: TimeRange): TimeRange | undefined => {
  const start = Math.max(epochMs(a.start), epochMs(b.start));
  const end = Math.min(epochMs(a.end), epochMs(b.end));
  return start < end ? { start: at(start), end: at(end) } : undefined;
};

/**
 * Sorts ranges and merges the ones that overlap or touch. Empty ranges are dropped. The result is
 * the minimal, ordered set of ranges covering the same instants.
 */
export const mergeRanges = (ranges: ReadonlyArray<TimeRange>): Array<TimeRange> => {
  const sorted = ranges
    .map((range) => ({ start: epochMs(range.start), end: epochMs(range.end) }))
    .filter((range) => range.start < range.end)
    .toSorted((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map((range) => ({ start: at(range.start), end: at(range.end) }));
};

/**
 * The parts of `within` that `covered` does not cover, in order. Used for "missing 00:42 at
 * 13:12": pass the recording range and the ranges the segment store actually holds.
 */
export const gaps = (within: TimeRange, covered: ReadonlyArray<TimeRange>): Array<TimeRange> => {
  const result: Array<TimeRange> = [];
  let cursor = epochMs(within.start);
  const end = epochMs(within.end);
  for (const range of mergeRanges(covered)) {
    if (epochMs(range.end) <= cursor) continue;
    if (epochMs(range.start) >= end) break;
    if (epochMs(range.start) > cursor)
      result.push({ start: at(cursor), end: at(epochMs(range.start)) });
    cursor = Math.max(cursor, epochMs(range.end));
  }
  if (cursor < end) result.push({ start: at(cursor), end: at(end) });
  return result;
};

/** Day of the week, as stored in rules. */
export const Weekday = Schema.Literals(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = typeof Weekday.Type;

const weekdaysFromSunday: ReadonlyArray<Weekday> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

/** Calendar parts of an instant in an IANA time zone. */
export interface LocalParts {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: Weekday;
}

/**
 * Reads the local calendar parts of `instant` (or epoch milliseconds) in `timeZone` (e.g.
 * "Europe/Berlin").
 */
export const localParts = (instant: Instant | number, timeZone: string): LocalParts => {
  const parts = DateTime.toParts(DateTime.makeZonedUnsafe(instant, { timeZone }));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    weekday: weekdaysFromSunday[parts.weekDay] ?? "sun",
  };
};

/** Sum of the lengths of the merged ranges, so overlapping parts are counted once. */
export const totalMillis = (ranges: ReadonlyArray<TimeRange>): number =>
  mergeRanges(ranges).reduce((sum, range) => sum + durationMillis(range), 0);

/** Accepts an instant or epoch milliseconds, the two ways clients carry a moment. */
const toMillis = (instant: Instant | number): number =>
  typeof instant === "number" ? instant : epochMs(instant);

/**
 * The calendar date of a moment in `timeZone`, as whole days since 1970-01-01. Two moments on
 * the same local date get the same number, whatever the process time zone.
 */
export const calendarDayNumber = (instant: Instant | number, timeZone: string): number => {
  const parts = localParts(at(toMillis(instant)), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY;
};

/**
 * Local midnight of the calendar day `instant` falls on in `timeZone`, as an instant. On a DST
 * change the day is 23 or 25 hours long, so never step days by adding {@link DAY}.
 */
export const startOfCalendarDay = (instant: Instant | number, timeZone: string): Instant =>
  DateTime.toUtc(
    DateTime.startOf(DateTime.makeZonedUnsafe(toMillis(instant), { timeZone }), "day"),
  );

/**
 * Whole calendar days from `now` to `moment` in `timeZone`: 0 today, 1 tomorrow, -1 yesterday. It
 * compares dates, not 24-hour steps, so 00:30 tomorrow is 1 and a DST change never shifts a day.
 */
export const calendarDayOffset = (
  now: Instant | number,
  moment: Instant | number,
  timeZone: string,
): number => calendarDayNumber(moment, timeZone) - calendarDayNumber(now, timeZone);

/** Missing parts of a recording window, ready to show ("2 gaps, 4 min missing"). */
export interface GapSummary {
  /** Sorted, clipped to the window, with overlapping, touching and repeated gaps merged. */
  readonly gaps: Array<TimeRange>;
  /** How much of the window is missing, overlaps counted once. */
  readonly missingMs: number;
  /** True when nothing of a non-empty window was captured. */
  readonly coversWindow: boolean;
}

/**
 * Normalises reported gaps against the window they belong to. Gap lists come from several
 * places (capture restarts, the segment store) and may repeat, overlap, touch or reach outside
 * the window; this is the one place they become what a person reads.
 */
export const summariseGaps = (
  reported: ReadonlyArray<TimeRange>,
  window: TimeRange,
): GapSummary => {
  const merged = mergeRanges(
    reported.flatMap((gap) => {
      const clipped = intersection(gap, window);
      return clipped === undefined ? [] : [clipped];
    }),
  );
  const missingMs = totalMillis(merged);
  const windowMs = durationMillis(window);
  return { gaps: merged, missingMs, coversWindow: windowMs > 0 && missingMs >= windowMs };
};
