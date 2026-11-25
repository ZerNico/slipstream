import {
  type ArtworkStyle,
  artworkStyle,
  type GuideDay,
  timeOnDay,
  type Programme,
  type Weekday,
} from "@slipstream/domain";

/*
 * Pure guide logic (SPEC §8.2): days, slots, categories, cell placement in pixels, markers and
 * arrow-key movement. The components draw exactly what these return. Days are calendar days in
 * the household's time zone (the server's `system.timeZone`), the zone the server's own day
 * boundaries, rules and groups use, never the browser's.
 */

// The shared timeline lives in the domain; the guide imports it from here with the rest.
export {
  dayAt,
  dayKey,
  dayOf,
  gridWindow,
  guideDays,
  nextAfter,
  pillDay,
  placeRow,
  programmeAt,
  requestWindow,
  rowsByChannel,
  rulerTicks,
  scrollLeftFor,
  timeOnDay,
  visibleChannels,
  visibleDayAt,
  windowWidth,
  xOf,
  type GuideDay,
  type GuideWindow,
  type PlacedCell,
} from "@slipstream/domain";

const weekdays: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Stand-in days while the household's zone loads, so the skeleton has the loaded page's
 * geometry: the same count of pills and day windows, laid out on this browser's calendar (the
 * closest guess there is, and the household's in most homes). They are never a household date:
 * their keys match no `day` param, nothing day-bound is fetched for them and only the skeleton
 * draws them.
 */
export const pendingGuideDays = (now: number, count = 8): readonly GuideDay[] =>
  Array.from({ length: count }, (_, offset) => {
    const local = new Date(now);
    local.setHours(0, 0, 0, 0);
    local.setDate(local.getDate() + offset);
    const start = local.getTime();
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    return {
      key: `pending-${offset}`,
      start,
      end: next.getTime(),
      offset,
      weekday: weekdays[local.getDay()] ?? "mon",
      date: local.getDate(),
      timeZone: undefined,
    };
  });

/** The day the URL names, or today when it names none or one out of range. */
export const pickDay = (days: readonly GuideDay[], key: string | undefined): GuideDay => {
  const found = days.find((day) => day.key === key);
  const first = days[0];
  if (found) return found;
  if (!first) throw new Error("guideDays returned no days");
  return first;
};

// ---------------------------------------------------------------------------------------------
// Time slots ("What's on at")

/** The time-slot chips: now, early evening, prime time, late. */
export type SlotKey = "now" | "19:00" | "20:15" | "22:00";

/** Every slot in chip order. */
const slotKeys: readonly SlotKey[] = ["now", "19:00", "20:15", "22:00"];

/** The slots a day offers: now only on today. */
export const slotsFor = (day: GuideDay): readonly SlotKey[] =>
  day.offset === 0 ? slotKeys : slotKeys.filter((slot) => slot !== "now");

/** A time of day someone picked, as the URL writes it: "21:30". */
export type ClockKey = `${number}:${number}`;

/** What the Channels view shows: one of the slot chips, or a time someone picked. */
export type GuideAt = SlotKey | ClockKey;

const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/u;

/** A picked time of day ("21:30"), when `value` is one. */
export const asClock = (value: string): ClockKey | undefined =>
  clockPattern.test(value) ? (value as ClockKey) : undefined;

/** Whether the shown time is one of the slot chips rather than a picked time. */
export const isSlot = (at: GuideAt): at is SlotKey => slotKeys.some((key) => key === at);

/**
 * The time the URL names (a slot or a picked "HH:MM"), else now on today and prime time on other
 * days.
 */
export const pickSlot = (value: string | undefined, day: GuideDay): GuideAt => {
  const found = slotKeys.find((key) => key === value);
  if (found && !(found === "now" && day.offset !== 0)) return found;
  const picked = value === undefined ? undefined : asClock(value);
  if (picked !== undefined) return picked;
  return day.offset === 0 ? "now" : "20:15";
};

/** The moment a slot or a picked time stands for on a day. */
export const slotTime = (slot: GuideAt, day: GuideDay, now: number): number => {
  if (slot === "now") return now;
  const [hours = 0, minutes = 0] = slot.split(":").map(Number);
  return timeOnDay(day, hours, minutes);
};

/** Prime time on a day, the `P` key and the "20:15" button. */
export const primeTime = (day: GuideDay): number => timeOnDay(day, 20, 15);

// ---------------------------------------------------------------------------------------------
// Categories

/** The category chips; programmes of other kinds are dimmed, never hidden. */
export type GuideCategory = "all" | Exclude<ArtworkStyle, "show">;

/** Every category in chip order. */
export const guideCategories: readonly GuideCategory[] = [
  "all",
  "sport",
  "film",
  "crime",
  "docs",
  "kids",
  "news",
];

/** The category the URL names, or all. */
export const pickCategory = (value: string | undefined): GuideCategory =>
  guideCategories.find((category) => category === value) ?? "all";

/**
 * Whether a programme belongs to a category, by the same genre reading the generated artwork
 * uses (guide categories first, then the title), so a sport cell and its sport artwork agree.
 */
export const inCategory = (programme: Programme, category: GuideCategory): boolean =>
  category === "all" || artworkStyle(programme.categories, programme.title) === category;

/** Pixels per minute: 5 from 1100 px, 4 below (SPEC §8.2). */
export const pixelsPerMinute = (desktop: boolean): number => (desktop ? 5 : 4);

/** The channel column with names (from 1100 px), and the narrow one with number and logo, px. */
const wideColumnWidth = 208;
const narrowColumnWidth = 96;

/**
 * Channel column width: the wide column with names from 1100 px; below that and in short
 * landscape the narrow column with number and logo only (the name stays in the row's label).
 */
export const channelColumnWidth = (desktop: boolean, short: boolean): number =>
  desktop && !short ? wideColumnWidth : narrowColumnWidth;

/** Whether the channel column is the narrow one, number and logo without the name. */
export const narrowChannelColumn = (desktop: boolean, short: boolean): boolean =>
  channelColumnWidth(desktop, short) === narrowColumnWidth;

/** Minutes between two ruler labels: every half hour, as the domain's `rulerTicks` lays them. */
export const tickMinutes = 30;

/**
 * The first ruler label whose left edge is clear of the sticky channel column, by index: the
 * labels before it start under the column and would show cut, so they fade. `scrollLeft` is the
 * grid's horizontal scroll, which is how far the cell area has moved under the column.
 */
export const firstClearTick = (scrollLeft: number, ppm: number): number =>
  Math.max(0, Math.ceil(scrollLeft / (tickMinutes * ppm) - 1e-6));

// ---------------------------------------------------------------------------------------------
// Keyboard

/** A cell as arrow-key movement sees it. */
export interface NavCell {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The grid's rows for the arrow keys, row by row: an array does, and so does a lazy list that
 * works a row out only when the keys reach it (a guide of a thousand channels).
 */
export interface NavRows {
  readonly length: number;
  readonly at: (index: number) => readonly NavCell[] | undefined;
}

/** A position in the grid: row and cell index. */
export interface NavPosition {
  readonly row: number;
  readonly index: number;
}

/**
 * Arrow-key movement in the grid (SPEC §7.2): left and right step through a row; up and down
 * keep the time position (now for the programme on air, else its start, clamped to the window)
 * and skip rows without programmes. Returns undefined when there is nowhere to go.
 */
export const moveInGrid = (
  rows: NavRows,
  from: NavPosition,
  key: string,
  now: number,
  windowStart: number,
): NavPosition | undefined => {
  const row = rows.at(from.row);
  const cell = row?.[from.index];
  if (!row || !cell) return undefined;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const index = from.index + (key === "ArrowLeft" ? -1 : 1);
    return index >= 0 && index < row.length ? { row: from.row, index } : undefined;
  }
  if (key !== "ArrowUp" && key !== "ArrowDown") return undefined;
  const anchor = cell.start <= now && cell.end > now ? now : Math.max(cell.start, windowStart);
  const step = key === "ArrowUp" ? -1 : 1;
  for (let next = from.row + step; next >= 0 && next < rows.length; next += step) {
    const candidates = rows.at(next) ?? [];
    let best: { index: number; distance: number } | undefined;
    candidates.forEach((candidate, index) => {
      const distance =
        candidate.start <= anchor && candidate.end > anchor
          ? -1
          : Math.abs(candidate.start - anchor);
      if (best === undefined || distance < best.distance) best = { index, distance };
    });
    if (best !== undefined) return { row: next, index: best.index };
  }
  return undefined;
};

/** The cell that takes Tab first: the first programme on air, else the first cell. */
export const initialPosition = (rows: NavRows, now: number): NavPosition | undefined => {
  let first: number | undefined;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows.at(rowIndex) ?? [];
    const index = row.findIndex((cell) => cell.start <= now && cell.end > now);
    if (index !== -1) return { row: rowIndex, index };
    if (first === undefined && row.length > 0) first = rowIndex;
  }
  return first === undefined ? undefined : { row: first, index: 0 };
};
