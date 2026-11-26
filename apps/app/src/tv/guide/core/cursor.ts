import {
  ceilTo,
  firstEndingAfter,
  floorTo,
  hasData,
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
 * `row` and `programme` name the focused cell. `programme` is -1 when the channel airs nothing at
 * `anchor` (a gap, or no guide data at all): the cursor then rests on the row's empty space, one
 * "nothing in the guide" cell, and OK still watches the channel. `anchor` is the time the person
 * is "at": up and down keep it, so moving through channels stays in the same time slot even when
 * programme boundaries differ, and every channel is reachable whether it has data or not.
 * `viewStart` is the left edge of the time axis and `topRow` the first row in the viewport.
 *
 * Invariants kept by {@link step}: `viewStart <= anchor < viewStart + visibleSpan`, `programme`
 * is the one airing at `anchor` on that row (-1 when none is), and `row` lies within
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

/** The programme airing at `time` on `row`, or -1 (the row's empty space). */
const airingOn = (guide: Guide, row: number, time: number): number =>
  programmeIndexAt(programmesOf(guide, row), time);

/** Whether a row has a programme airing at `time`. */
const covers = (guide: Guide, row: number, time: number): boolean =>
  airingOn(guide, row, time) !== -1;

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

/** Lands on `row` at `anchor`, focusing what airs then (or the row's empty space). */
const landOn = (
  guide: Guide,
  config: GuideConfig,
  base: GuideCursor,
  row: number,
  anchor: number,
  viewStart: number,
): GuideCursor => ({
  row,
  programme: airingOn(guide, row, anchor),
  anchor,
  viewStart: revealTime(guide, config, viewStart, anchor),
  topRow: revealRow(guide, config, base.topRow, row),
});

/** The row to settle on at `time`: the nearest one airing something, else `row` itself. */
const settleRow = (guide: Guide, row: number, time: number): number => {
  const covering = nearestRow(guide, row, (candidate) => covers(guide, candidate, time));
  return covering === -1 ? row : covering;
};

/** Moves `rows` rows (negative is up) at the same anchor, stopping at the first and last row. */
const moveRows = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  rows: number,
  topRow: number,
): GuideCursor => {
  const row = clamp(cursor.row + rows, 0, guide.channels.length - 1);
  if (row === cursor.row) return cursor;
  return {
    ...cursor,
    row,
    programme: airingOn(guide, row, cursor.anchor),
    topRow: revealRow(guide, config, topRow, row),
  };
};

const moveVertical = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  direction: Direction,
  steps: number,
): GuideCursor => moveRows(guide, config, cursor, direction * steps, cursor.topRow);

/**
 * The programme `steps` along from the cursor. From the empty space between programmes, the
 * first step goes to the next programme after the gap (right) or the last one before it (left).
 */
const horizontalTarget = (
  programmes: readonly GuideProgramme[],
  cursor: GuideCursor,
  direction: Direction,
  steps: number,
): number => {
  if (cursor.programme !== -1) return cursor.programme + direction * steps;
  // Nothing airs at the anchor, so the first programme ending after it starts after it.
  const next = firstEndingAfter(programmes, cursor.anchor);
  return direction === 1 ? next + steps - 1 : next - steps;
};

const moveHorizontal = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  direction: Direction,
  steps: number,
): GuideCursor => {
  const programmes = programmesOf(guide, cursor.row);
  if (programmes.length === 0) return cursor;
  const target = clamp(
    horizontalTarget(programmes, cursor, direction, steps),
    0,
    programmes.length - 1,
  );
  const programme = programmes[target];
  if (target === cursor.programme || programme === undefined) return cursor;
  // From a gap, a programme on the wrong side means there is none that way.
  if (cursor.programme === -1 && programme.start > cursor.anchor !== (direction === 1)) {
    return cursor;
  }
  const viewStart = revealProgramme(guide, config, cursor.viewStart, programme);
  return {
    ...cursor,
    programme: target,
    anchor: Math.max(programme.start, viewStart),
    viewStart,
  };
};

/** CH +/-: `pageRows` rows at once, whatever they air, scrolling the viewport with the cursor. */
const page = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  direction: Direction,
): GuideCursor => {
  const row = clamp(cursor.row + direction * config.pageRows, 0, guide.channels.length - 1);
  const maxTop = Math.max(0, guide.channels.length - config.visibleRows);
  const scrolled = clamp(cursor.topRow + (row - cursor.row), 0, maxTop);
  return moveRows(guide, config, cursor, row - cursor.row, scrolled);
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
  return landOn(guide, config, cursor, cursor.row, anchor, shifted);
};

/** The time axis a jump to now puts in view. */
const nowView = (guide: Guide, config: GuideConfig, now: number): number =>
  clampView(guide, config, floorTo(clampTime(guide, now) - config.nowLead, config.slot));

const jumpNow = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  now: number,
  row = cursor.row,
): GuideCursor =>
  landOn(guide, config, cursor, row, clampTime(guide, now), nowView(guide, config, now));

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
  const row = rowForChannelNumber(guide.channels, number);
  if (row === -1) return cursor;
  return landOn(guide, config, cursor, row, cursor.anchor, cursor.viewStart);
};

const sameCursor = (a: GuideCursor, b: GuideCursor): boolean =>
  a.row === b.row &&
  a.programme === b.programme &&
  a.anchor === b.anchor &&
  a.viewStart === b.viewStart &&
  a.topRow === b.topRow;

/**
 * The cursor to start with: at `now` with the time axis showing `nowLead` of the past, on `row`
 * or the nearest row airing something then, so the guide opens on a programme. Rows with nothing
 * on stay reachable by moving to them.
 */
export const initialCursor = (
  guide: Guide,
  config: GuideConfig,
  now: number,
  row = 0,
): GuideCursor => {
  const start = clamp(row, 0, Math.max(0, guide.channels.length - 1));
  const base: GuideCursor = { row: start, programme: -1, anchor: now, viewStart: 0, topRow: 0 };
  return jumpNow(guide, config, base, now, settleRow(guide, start, clampTime(guide, now)));
};

/**
 * Applies one action. Returns the very same cursor object when the action changes nothing
 * (at an edge), so callers can detect edges
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
 * Whether the cursor already shows "now": it focuses what airs at `now` on its row (the empty
 * space when nothing does) and the time axis sits where a jump to now would put it. Back uses
 * this: first back to now, then out.
 */
export const isAtNow = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
  now: number,
): boolean =>
  cursor.programme === airingOn(guide, cursor.row, clampTime(guide, now)) &&
  cursor.viewStart === nowView(guide, config, now);

/**
 * The time the empty cell covers while the cursor rests on a row's empty space: from the end of
 * the programme before the anchor to the start of the one after it, cut to the viewport.
 * Undefined while the cursor focuses a programme.
 */
export const emptySpan = (
  guide: Guide,
  config: GuideConfig,
  cursor: GuideCursor,
): { readonly start: number; readonly end: number } | undefined => {
  if (cursor.programme !== -1 || guide.channels[cursor.row] === undefined) return undefined;
  const programmes = programmesOf(guide, cursor.row);
  const next = firstEndingAfter(programmes, cursor.anchor);
  const viewEnd = cursor.viewStart + config.visibleSpan;
  return {
    start: Math.max(programmes[next - 1]?.end ?? cursor.viewStart, cursor.viewStart),
    end: Math.min(programmes[next]?.start ?? viewEnd, viewEnd),
  };
};

/** The focused channel and programme (no programme on the row's empty space). */
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
  return landOn(next, config, base, row, anchor, viewStart);
};
