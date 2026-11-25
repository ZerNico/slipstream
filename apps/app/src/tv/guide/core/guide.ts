import { HOUR, MINUTE } from "@slipstream/domain";

/** One programme on a channel. Times are epoch milliseconds; `end` is exclusive. */
export interface GuideProgramme {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

/**
 * One guide row: a channel and its programmes, sorted by start and not overlapping. `P` lets
 * callers carry their own programme fields (title, flags) through the cursor and window.
 */
export interface GuideChannel<P extends GuideProgramme = GuideProgramme> {
  readonly id: string;
  readonly number: number;
  readonly programmes: readonly P[];
}

/**
 * The guide as the cursor sees it. Built with {@link makeGuide}, which sorts programmes and
 * records the time range the data covers (`start` to `end`; both 0 when there is no data).
 */
export interface Guide<P extends GuideProgramme = GuideProgramme> {
  readonly channels: readonly GuideChannel<P>[];
  readonly start: number;
  readonly end: number;
}

/** Layout and paging settings for the guide grid. Durations are milliseconds. */
export interface GuideConfig {
  /** Rows that fit in the viewport. */
  readonly visibleRows: number;
  /** Width of the viewport on the time axis. */
  readonly visibleSpan: number;
  /** Grid step the time axis snaps to when it scrolls (the ruler's tick spacing). */
  readonly slot: number;
  /** Rows one CH+/CH- press moves. */
  readonly pageRows: number;
  /** How much of the past stays visible left of "now" after jumping to now. */
  readonly nowLead: number;
}

/** Defaults from the TV guide mockup: 7 rows, 3 hours wide, 30 minute ticks, CH +/- pages 7. */
export const defaultGuideConfig: GuideConfig = {
  visibleRows: 7,
  visibleSpan: 3 * HOUR,
  slot: 30 * MINUTE,
  pageRows: 7,
  nowLead: 30 * MINUTE,
};

const isSorted = (programmes: readonly GuideProgramme[]): boolean =>
  programmes.every((programme, index) => {
    const previous = programmes[index - 1];
    return previous === undefined || previous.start <= programme.start;
  });

/**
 * Builds a {@link Guide}: drops programmes that do not last any time, sorts the rest by start
 * (only copying when they are out of order) and computes the covered time range.
 */
export const makeGuide = <P extends GuideProgramme>(
  channels: readonly GuideChannel<P>[],
): Guide<P> => {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const normalised = channels.map((channel) => {
    const valid = channel.programmes.every((programme) => programme.end > programme.start)
      ? channel.programmes
      : channel.programmes.filter((programme) => programme.end > programme.start);
    const programmes = isSorted(valid) ? valid : valid.toSorted((a, b) => a.start - b.start);
    const first = programmes[0];
    const last = programmes.at(-1);
    if (first !== undefined && last !== undefined) {
      start = Math.min(start, first.start);
      end = Math.max(end, last.end);
    }
    return programmes === channel.programmes ? channel : { ...channel, programmes };
  });
  return start <= end
    ? { channels: normalised, start, end }
    : { channels: normalised, start: 0, end: 0 };
};

/** Whether the guide holds any programme at all. */
export const hasData = (guide: Guide): boolean => guide.end > guide.start;

/** Index of the last programme starting at or before `time`, or -1. */
const lastStartingBy = (programmes: readonly GuideProgramme[], time: number): number => {
  let low = 0;
  let high = programmes.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const programme = programmes[mid];
    if (programme !== undefined && programme.start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
};

/** Index of the programme airing at `time` on this channel, or -1 when nothing is on. */
export const programmeIndexAt = (programmes: readonly GuideProgramme[], time: number): number => {
  const index = lastStartingBy(programmes, time);
  const programme = programmes[index];
  return programme !== undefined && programme.end > time ? index : -1;
};

/**
 * Index of the programme closest to `time`: the one airing, otherwise whichever of the previous
 * and next programme is nearer in time (the next one wins a tie). -1 for a channel without data.
 */
export const nearestProgrammeIndex = (
  programmes: readonly GuideProgramme[],
  time: number,
): number => {
  const before = lastStartingBy(programmes, time);
  const previous = programmes[before];
  if (previous !== undefined && previous.end > time) return before;
  const next = programmes[before + 1];
  if (previous === undefined) return next === undefined ? -1 : before + 1;
  if (next === undefined) return before;
  return next.start - time <= time - previous.end ? before + 1 : before;
};

/** Index of the first programme still running at or after `time` (ending after it). */
export const firstEndingAfter = (programmes: readonly GuideProgramme[], time: number): number => {
  const index = lastStartingBy(programmes, time);
  const programme = programmes[index];
  if (programme !== undefined && programme.end > time) return index;
  return index + 1;
};

/** Rounds `time` down to a multiple of `step` (epoch-aligned, so 30 minutes means :00 and :30). */
export const floorTo = (time: number, step: number): number => Math.floor(time / step) * step;

/** Rounds `time` up to a multiple of `step`. */
export const ceilTo = (time: number, step: number): number => Math.ceil(time / step) * step;
