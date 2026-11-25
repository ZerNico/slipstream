import {
  ceilTo,
  floorTo,
  hasData,
  nearestProgrammeIndex,
  programmeIndexAt,
  type Guide,
  type GuideChannel,
  type GuideConfig,
  type GuideProgramme,
} from "./guide.ts";
import { DAY } from "@slipstream/domain";

/**
 * Where the guide cursor is and what the viewport shows.
 *
 * `row` and `programme` name the focused cell (`programme` is -1 only on a channel without any
 * data). `anchor` is the time the person is "at": up and down keep it, so moving through
 * channels stays in the same time slot even when programme boundaries differ. `viewStart` is the
 * left edge of the time axis and `topRow` the first row in the viewport.
 *
 * Invariants kept by {@link step}: `viewStart <= anchor < viewStart + visibleSpan`, the focused
 * programme is airing at `anchor` (unless the channel has no data), and `row` lies within
 * `[topRow, topRow + visibleRows)`.
 */
export interface GuideCursor {
  readonly row: number;
  readonly programme: number;
  readonly anchor: number;
  readonly viewStart: number;
  readonly topRow: number;
}

/** Something the person asked the guide to do. Arrow moves take a step count for held keys. */
export type GuideAction =
  | { readonly _tag: "Up" | "Down" | "Left" | "Right"; readonly steps?: number }
  | { readonly _tag: "PageUp" | "PageDown" }
  | { readonly _tag: "DayBack" | "DayForward" }
  | { readonly _tag: "Now"; readonly now: number }
  | { readonly _tag: "Channel"; readonly number: number };

type Direction = 1 | -1;

const programmesOf = (guide: Guide, row: number): readonly GuideProgramme[] =>
  guide.channels[row]?.programmes ?? [];

/** Whether a row has a programme airing at `time` (rows without one are skipped). */
const covers = (guide: Guide, row: number, time: number): boolean =>
  programmeIndexAt(programmesOf(guide, row), time) !== -1;

/** First row from `from` (inclusive) walking in `direction` that airs something at `time`. */
const coveringRowFrom = (
  guide: Guide,
  from: number,
  direction: Direction,
  time: number,
): number => {
  for (let row = from; row >= 0 && row < guide.channels.length; row += direction) {
    if (covers(guide, row, time)) return row;
  }
  return -1;
};

/** The row nearest to `row` that matches, looking below first on a tie; -1 when none does. */
const nearestRow = (guide: Guide, row: number, matches: (row: number) => boolean): number => {
  const count = guide.channels.length;
  for (let distance = 0; distance < count; distance++) {
    const below = row + distance;
    const above = row - distance;
    if (below < count && matches(below)) return below;
    if (above >= 0 && distance > 0 && matches(above)) return above;
    if (below >= count && above < 0) break;
  }
  return -1;
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** Keeps the time axis inside the data (when there is data) on slot boundaries. */
const clampView = (guide: Guide, config: GuideConfig, viewStart: number): number => {
  if (!hasData(guide)) return viewStart;
  const low = floorTo(guide.start, config.slot);
  const high = Math.max(low, ceilTo(guide.end, config.slot) - config.visibleSpan);
  return clamp(viewStart, low, high);
};

/** Clamps a time to the data range so jumps never leave the guide. */
const clampTime = (guide: Guide, time: number): number =>
  hasData(guide) ? clamp(time, guide.start, guide.end - 1) : time;

/** Scrolls rows the least amount that brings `row` into the viewport. */
const revealRow = (guide: Guide, config: GuideConfig, topRow: number, row: number): number => {
  const maxTop = Math.max(0, guide.channels.length - config.visibleRows);
  const top =
    row < topRow ? row : row >= topRow + config.visibleRows ? row - config.visibleRows + 1 : topRow;
  return clamp(top, 0, maxTop);
};

/**
 * Scrolls the time axis so a programme's start is on screen. Moving left past the edge puts the
 * programme's start at the left; moving right past the last slot keeps one slot of context.
 */
const revealProgramme = (
  guide: Guide,
  config: GuideConfig,
  viewStart: number,
  programme: GuideProgramme,
): number => {
  const viewEnd = viewStart + config.visibleSpan;
  if (programme.start < viewStart)
    return clampView(guide, config, floorTo(programme.start, config.slot));
  if (programme.start >= viewEnd - config.slot) {
    const shifted = floorTo(programme.start, config.slot) - config.slot;
    return clampView(guide, config, Math.max(shifted, viewStart + config.slot));
  }
  return viewStart;
};

/** Moves the time axis just enough to show `time`, used when the anchor jumps. */
const revealTime = (guide: Guide, config: GuideConfig, viewStart: number, time: number): number => {
  if (time >= viewStart && time < viewStart + config.visibleSpan) return viewStart;
  return clampView(guide, config, floorTo(time - config.nowLead, config.slot));
};

/**
 * Lands on `row` at `anchor`. When nothing airs there the cursor takes the channel's nearest
 * programme and moves the anchor onto it, so the focused cell and the anchor always agree.
 */
const landOn = (
  guide: Guide,
  config: GuideConfig,
  base: GuideCursor,
  row: number,
  anchor: number,
  viewStart: number,
): GuideCursor => {
  const programmes = programmesOf(guide, row);
  const programme = nearestProgrammeIndex(programmes, anchor);
  const focused = programmes[programme];
  const time =
    focused === undefined || (focused.start <= anchor && focused.end > anchor)
      ? anchor
      : focused.start > anchor
        ? focused.start
        : focused.end - 1;
  const view = revealTime(guide, config, viewStart, time);
  return {
    row,
    programme,
    anchor: time,
    viewStart: view,
    topRow: revealRow(guide, config, base.topRow, row),
  };
};

/** The row to settle on at `time`: the nearest one airing something, else `row` itself. */
const settleRow = (guide: Guide, row: number, time: number): number => {
  const covering = nearestRow(guide, row, (candidate) => covers(guide, candidate, time));
  return covering === -1 ? row : covering;
};

const moveVertical = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  direction: Direction,
  steps: number,
): GuideCursor => {
  let row = cursor.row;
  for (let taken = 0; taken < steps; taken++) {
    const next = coveringRowFrom(guide, row + direction, direction, cursor.anchor);
    if (next === -1) break;
    row = next;
  }
  if (row === cursor.row) return cursor;
  return {
    ...cursor,
    row,
    programme: programmeIndexAt(programmesOf(guide, row), cursor.anchor),
    topRow: revealRow(guide, config, cursor.topRow, row),
  };
};

const moveHorizontal = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  direction: Direction,
  steps: number,
): GuideCursor => {
  const programmes = programmesOf(guide, cursor.row);
  if (cursor.programme === -1) return cursor;
  const target = clamp(cursor.programme + direction * steps, 0, programmes.length - 1);
  const programme = programmes[target];
  if (target === cursor.programme || programme === undefined) return cursor;
  const viewStart = revealProgramme(guide, config, cursor.viewStart, programme);
  return {
    ...cursor,
    programme: target,
    anchor: Math.max(programme.start, viewStart),
    viewStart,
  };
};

const page = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  direction: Direction,
): GuideCursor => {
  const last = guide.channels.length - 1;
  const target = clamp(cursor.row + direction * config.pageRows, 0, last);
  let row = coveringRowFrom(guide, target, direction, cursor.anchor);
  if (row === -1) {
    // Nothing airs beyond the target: take the farthest covering row short of it.
    row = coveringRowFrom(guide, target - direction, direction === 1 ? -1 : 1, cursor.anchor);
    if (direction === 1 ? row <= cursor.row : row >= cursor.row) row = -1;
  }
  if (row === -1 || row === cursor.row) return cursor;
  const maxTop = Math.max(0, guide.channels.length - config.visibleRows);
  const scrolled = clamp(cursor.topRow + (row - cursor.row), 0, maxTop);
  return {
    ...cursor,
    row,
    programme: programmeIndexAt(programmesOf(guide, row), cursor.anchor),
    topRow: revealRow(guide, config, scrolled, row),
  };
};

const jumpDay = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  direction: Direction,
): GuideCursor => {
  const anchor = clampTime(guide, cursor.anchor + direction * DAY);
  if (anchor === cursor.anchor) return cursor;
  const shifted = clampView(guide, config, cursor.viewStart + (anchor - cursor.anchor));
  return landOn(guide, config, cursor, settleRow(guide, cursor.row, anchor), anchor, shifted);
};

const jumpNow = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  now: number,
): GuideCursor => {
  const anchor = clampTime(guide, now);
  const viewStart = clampView(guide, config, floorTo(anchor - config.nowLead, config.slot));
  return landOn(guide, config, cursor, settleRow(guide, cursor.row, anchor), anchor, viewStart);
};

/** Row of channel `number`, else the next higher number, else the last row; -1 without rows. */
export const rowForChannelNumber = (channels: readonly GuideChannel[], number: number): number => {
  const exact = channels.findIndex((channel) => channel.number === number);
  if (exact !== -1) return exact;
  let best = -1;
  channels.forEach((channel, row) => {
    const current = channels[best];
    if (channel.number > number && (current === undefined || channel.number < current.number)) {
      best = row;
    }
  });
  return best === -1 ? channels.length - 1 : best;
};

const jumpChannel = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  number: number,
): GuideCursor => {
  const target = rowForChannelNumber(guide.channels, number);
  if (target === -1) return cursor;
  const withData = nearestRow(guide, target, (row) => programmesOf(guide, row).length > 0);
  const row = withData === -1 ? target : withData;
  return landOn(guide, config, cursor, row, cursor.anchor, cursor.viewStart);
};

const sameCursor = (a: GuideCursor, b: GuideCursor): boolean =>
  a.row === b.row &&
  a.programme === b.programme &&
  a.anchor === b.anchor &&
  a.viewStart === b.viewStart &&
  a.topRow === b.topRow;

/**
 * The cursor to start with: on `row` (or the nearest row airing something) at `now`, with the
 * time axis showing `nowLead` of the past.
 */
export const initialCursor = (
  guide: Guide,
  config: GuideConfig,
  now: number,
  row = 0,
): GuideCursor => {
  const start = clamp(row, 0, Math.max(0, guide.channels.length - 1));
  const base: GuideCursor = { row: start, programme: -1, anchor: now, viewStart: 0, topRow: 0 };
  return jumpNow(guide, config, base, now);
};

/**
 * Applies one action. Returns the very same cursor object when the action changes nothing
 * (at an edge, or no channel airs anything in that direction), so callers can detect edges
 * with `===`, for example to hand focus back to the navigation rail.
 */
export const step = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  action: GuideAction,
): GuideCursor => {
  if (guide.channels.length === 0) return cursor;
  const steps = "steps" in action ? Math.max(1, Math.floor(action.steps ?? 1)) : 1;
  let next: GuideCursor;
  switch (action._tag) {
    case "Up":
      next = moveVertical(guide, config, cursor, -1, steps);
      break;
    case "Down":
      next = moveVertical(guide, config, cursor, 1, steps);
      break;
    case "Left":
      next = moveHorizontal(guide, config, cursor, -1, steps);
      break;
    case "Right":
      next = moveHorizontal(guide, config, cursor, 1, steps);
      break;
    case "PageUp":
      next = page(guide, config, cursor, -1);
      break;
    case "PageDown":
      next = page(guide, config, cursor, 1);
      break;
    case "DayBack":
      next = jumpDay(guide, config, cursor, -1);
      break;
    case "DayForward":
      next = jumpDay(guide, config, cursor, 1);
      break;
    case "Now":
      next = jumpNow(guide, config, cursor, action.now);
      break;
    case "Channel":
      next = jumpChannel(guide, config, cursor, action.number);
      break;
  }
  return sameCursor(next, cursor) ? cursor : next;
};

/**
 * Whether the cursor already shows "now": the focused programme is airing at `now` and the
 * time axis sits where a jump to now would put it. Back uses this: first back to now, then out.
 */
export const isAtNow = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  now: number,
): boolean => {
  const programme = programmesOf(guide, cursor.row)[cursor.programme];
  const time = clampTime(guide, now);
  const viewStart = clampView(guide, config, floorTo(time - config.nowLead, config.slot));
  return (
    programme !== undefined &&
    programme.start <= time &&
    programme.end > time &&
    cursor.viewStart === viewStart
  );
};

/** The focused channel and programme, if the channel has data. */
export const focusedCell = <P extends GuideProgramme>(
  guide: Guide<P>,
  cursor: GuideCursor,
): { readonly channel: GuideChannel<P>; readonly programme: P | undefined } | undefined => {
  const channel = guide.channels[cursor.row];
  if (channel === undefined) return undefined;
  return { channel, programme: channel.programmes[cursor.programme] };
};

/**
 * Re-finds the cursor after the guide data changed (a refresh): same channel id when it still
 * exists, same anchor time, viewport kept where possible.
 */
export const relocate = (
  previous: Guide,
  next: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
): GuideCursor => {
  if (next.channels.length === 0) return { ...cursor, row: 0, programme: -1, topRow: 0 };
  const id = previous.channels[cursor.row]?.id;
  const byId = next.channels.findIndex((channel) => channel.id === id);
  const row = byId === -1 ? clamp(cursor.row, 0, next.channels.length - 1) : byId;
  const anchor = clampTime(next, cursor.anchor);
  const viewStart = clampView(next, config, cursor.viewStart);
  const base = {
    ...cursor,
    topRow: clamp(cursor.topRow, 0, Math.max(0, next.channels.length - config.visibleRows)),
  };
  return landOn(next, config, base, settleRow(next, row, anchor), anchor, viewStart);
};
