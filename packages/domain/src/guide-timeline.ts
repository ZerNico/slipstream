import { DateTime } from "effect";
import type { ProgrammeMark } from "./marks.ts";
import type { GuideEntry } from "./programme.ts";
import {
  calendarDayOffset,
  DAY,
  epochMs,
  localParts,
  MINUTE,
  startOfCalendarDay,
  type Weekday,
} from "./time.ts";

/*
 * The guide's timeline, shared by web and phone: calendar days in the household's zone (never
 * the device's), the window the grid spans, programmes placed on a row and the ruler's ticks.
 * Each client picks its pixels per minute.
 */

// ---------------------------------------------------------------------------------------------
// Days

/** One day pill: a calendar day in the household's time zone. */
export interface GuideDay {
  /** `YYYY-MM-DD` in the household's zone, the `day` search param. */
  readonly key: string;
  /** Midnight in the household's zone, epoch ms. */
  readonly start: number;
  /** The next midnight there (23 or 25 hours later on a DST change). */
  readonly end: number;
  /** 0 for today. */
  readonly offset: number;
  readonly weekday: Weekday;
  /** Day of the month, for "Sun 22". */
  readonly date: number;
  /**
   * The IANA zone the day is counted in; undefined for a stand-in day drawn under the skeleton
   * while the household's zone loads ({@link pendingGuideDays}).
   */
  readonly timeZone: string | undefined;
}

const pad = (value: number) => String(value).padStart(2, "0");

const zoned = (millis: number, timeZone: string) => DateTime.makeZonedUnsafe(millis, { timeZone });

/** A household date as the `day` search param writes it. */
export const dayKey = (millis: number, timeZone: string): string => {
  const parts = localParts(DateTime.makeUnsafe(millis), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

/** The day a moment falls on in `timeZone`, counted from today (negative for days gone by). */
export const dayOf = (moment: number, now: number, timeZone: string): GuideDay => {
  const start = startOfCalendarDay(moment, timeZone);
  const parts = localParts(start, timeZone);
  return {
    key: dayKey(moment, timeZone),
    start: epochMs(start),
    end: DateTime.toEpochMillis(DateTime.add(zoned(epochMs(start), timeZone), { days: 1 })),
    offset: calendarDayOffset(now, moment, timeZone),
    weekday: parts.weekday,
    date: parts.day,
    timeZone,
  };
};

/** The guide's days: today and the next `count - 1` in the household's calendar (DST safe). */
export const guideDays = (now: number, timeZone: string, count = 8): readonly GuideDay[] => {
  const today = DateTime.startOf(zoned(now, timeZone), "day");
  // Noon of each day is safely inside it, whatever a DST change does to the day's length.
  return Array.from({ length: count }, (_, offset) =>
    dayOf(DateTime.toEpochMillis(DateTime.add(today, { days: offset, hours: 12 })), now, timeZone),
  );
};
/** How the pills and sentences name a day: `today` or its weekday. */
export const pillDay = (day: GuideDay): Weekday | "today" =>
  day.offset === 0 ? "today" : day.weekday;
/**
 * A wall-clock time on a day in the household's zone, DST safe. A stand-in day has no zone; it
 * gets the same offset into its window, so the skeleton scrolls where the loaded grid will.
 */
export const timeOnDay = (day: GuideDay, hours: number, minutes: number): number =>
  day.timeZone === undefined
    ? day.start + (hours * 60 + minutes) * MINUTE
    : DateTime.toEpochMillis(
        DateTime.setParts(zoned(day.start, day.timeZone), {
          hour: hours,
          minute: minutes,
          second: 0,
          millisecond: 0,
        }),
      );

// ---------------------------------------------------------------------------------------------
// Channels and rows

/**
 * The fields the timeline reads of a programme. Its functions keep whatever else a caller's
 * programmes carry (a full `Programme`, a `GuideEntry`, an app's own), so they hand it back.
 */
export type TimelineProgramme = Pick<
  GuideEntry,
  "id" | "channelId" | "start" | "end" | "title" | "categories"
>;

/** A channel's programmes in start order. */
export const rowsByChannel = <P extends TimelineProgramme>(
  programmes: readonly P[],
): ReadonlyMap<string, readonly P[]> => {
  const rows = new Map<string, P[]>();
  for (const programme of programmes) {
    const row = rows.get(programme.channelId);
    if (row) row.push(programme);
    else rows.set(programme.channelId, [programme]);
  }
  for (const row of rows.values()) row.sort((a, b) => epochMs(a.start) - epochMs(b.start));
  return rows;
};

/** What airs at `at` in a start-ordered row. */
export const programmeAt = <P extends TimelineProgramme>(
  row: readonly P[],
  at: number,
): P | undefined =>
  row.find((programme) => epochMs(programme.start) <= at && epochMs(programme.end) > at);

/** The first programme starting at or after `programme` ends. */
export const nextAfter = <P extends TimelineProgramme>(
  row: readonly P[],
  programme: TimelineProgramme,
): P | undefined => row.find((candidate) => epochMs(candidate.start) >= epochMs(programme.end));

// ---------------------------------------------------------------------------------------------
// Timeline grid geometry

/** The stretch of time the grid shows, epoch ms: from today's midnight on, across the days. */
export interface GuideWindow {
  readonly from: number;
  readonly to: number;
}

/** The longest window one guide request may ask for: the server refuses longer ones. */
export const guideWindowMaxMillis = 8 * DAY;

/** What the guide asks the server for: its days, from today's midnight, within the limit. */
export const requestWindow = (days: readonly GuideDay[]): GuideWindow => {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) throw new Error("guideDays returned no days");
  return { from: first.start, to: Math.min(last.end, first.start + guideWindowMaxMillis) };
};

/**
 * The stretch the grid spans: from today's midnight to where the guide data ends (`dataEnd`,
 * from `GET /guide/extent`, rounded up to the half hour), at least today and never past the
 * days asked for, so the scrollbar ends where the programmes do. The end comes from the server
 * rather than the programmes loaded, so the grid has its full width before the later days load.
 */
export const gridWindow = (days: readonly GuideDay[], dataEnd: number | undefined): GuideWindow => {
  const asked = requestWindow(days);
  const today = days[0]?.end ?? asked.to;
  const lastEnd = Math.max(today, dataEnd ?? today);
  const half = 30 * MINUTE;
  const rounded = asked.from + Math.ceil((lastEnd - asked.from) / half) * half;
  return { from: asked.from, to: Math.min(asked.to, rounded) };
};

// ---------------------------------------------------------------------------------------------
// Loading by day

/**
 * The days a guide loads around the one in view: that day and `reach` days either side, so a
 * neighbour is there before scrolling reaches it. A day not among `days` counts as the first.
 */
export const daysAround = (
  days: readonly GuideDay[],
  key: string | undefined,
  reach = 1,
): readonly GuideDay[] => {
  const at = Math.max(
    0,
    days.findIndex((day) => day.key === key),
  );
  return days.slice(Math.max(0, at - reach), at + reach + 1);
};

/**
 * The days' answers as one list, each programme once: one running over midnight is in both
 * days' answers. Days not answered yet are left out.
 */
export const mergeDays = <P extends { readonly id: string }>(
  answers: readonly (readonly P[] | undefined)[],
): readonly P[] => {
  const seen = new Set<string>();
  const merged: P[] = [];
  for (const answer of answers) {
    for (const programme of answer ?? []) {
      if (seen.has(programme.id)) continue;
      seen.add(programme.id);
      merged.push(programme);
    }
  }
  return merged;
};

/** What a guide has of its days: the loaded ones merged, and which are still to come. */
export interface LoadedDays<P, R> {
  /** Every loaded day's programmes, each once (one over midnight is in two days' answers). */
  readonly programmes: readonly P[];
  /** The loaded days' airings the viewer already has. */
  readonly repeats: readonly R[];
  /** The keys of the days whose cells can be drawn. */
  readonly loaded: ReadonlySet<string>;
  /** The days not loaded yet: placeholders stand in their stretch of the timeline. */
  readonly pending: readonly GuideDay[];
}

/**
 * The days' answers (in the order of `days`) as one guide. A day counts as loaded once its
 * programmes and its repeat marks are both in, so no marker arrives after its title was drawn.
 */
export const loadedDays = <P extends { readonly id: string }, R>(
  days: readonly GuideDay[],
  programmes: readonly (readonly P[] | undefined)[],
  repeats: readonly (readonly R[] | undefined)[],
): LoadedDays<P, R> => {
  const loaded = new Set(
    days
      .filter((_, index) => programmes[index] !== undefined && repeats[index] !== undefined)
      .map((day) => day.key),
  );
  const ofLoaded = <A>(answers: readonly (A | undefined)[]) =>
    days.map((day, index) => (loaded.has(day.key) ? answers[index] : undefined));
  return {
    programmes: mergeDays(ofLoaded(programmes)),
    repeats: ofLoaded(repeats).flatMap((answer) => answer ?? []),
    loaded,
    pending: days.filter((day) => !loaded.has(day.key)),
  };
};

/** The day a moment falls on among the guide's days: the first or last one outside them. */
export const dayAt = (days: readonly GuideDay[], moment: number): GuideDay => {
  const found = days.find((day) => day.start <= moment && day.end > moment);
  if (found) return found;
  const edge = moment < (days[0]?.start ?? 0) ? days[0] : days.at(-1);
  if (!edge) throw new Error("guideDays returned no days");
  return edge;
};

/**
 * The day the grid shows at a scroll position: the one a third of the way into the visible
 * cells, so a day counts as shown once it fills most of the view.
 */
export const visibleDayAt = (
  days: readonly GuideDay[],
  window: GuideWindow,
  scrollLeft: number,
  visibleWidth: number,
  ppm: number,
): GuideDay => dayAt(days, window.from + ((scrollLeft + visibleWidth / 3) / ppm) * MINUTE);
/** Cells narrower than this are hatched micro cells without text. */
export const microWidth = 26;

/** Cells narrower than this drop their second line. */
export const tinyWidth = 70;

/** A programme placed on a row, in pixels from the window's start. */
export interface PlacedCell<P extends TimelineProgramme = GuideEntry> {
  readonly programme: P;
  /** Left edge, with the 2 px gutter between neighbours. */
  readonly x: number;
  readonly width: number;
  readonly when: "past" | "airing" | "future";
  /** How far through it is, 0 to 1, while it airs. */
  readonly progress: number;
  readonly mark?: ProgrammeMark | undefined;
  readonly size: "micro" | "tiny" | "full";
}

/** The width of a window at `ppm` pixels per minute. */
export const windowWidth = (window: GuideWindow, ppm: number): number =>
  ((window.to - window.from) / MINUTE) * ppm;

/** Where a moment sits in the grid's cell area, px. */
export const xOf = (window: GuideWindow, time: number, ppm: number): number =>
  ((time - window.from) / MINUTE) * ppm;

/** A skeleton block where a guide day still loads: its left edge and width on a row, px. */
export interface PendingBlock {
  readonly x: number;
  readonly width: number;
}

/**
 * Skeleton blocks over the guide days still loading, so their stretch of the timeline reads as
 * "coming", never as empty, and the cells land where the blocks were. Each day, within the
 * window, is cut every `blockMs`, the first cut `offsetMs` after the day's start when given (so
 * rows can stagger like a wall). Blocks that overlap `near` (epoch ms, the stretch around the
 * view) are kept whole, with the cells' 2 px gutter either side; slivers of 8 px or less are left
 * out.
 */
export const pendingBlocks = (input: {
  readonly days: readonly GuideDay[];
  readonly window: GuideWindow;
  readonly ppm: number;
  readonly near: { readonly from: number; readonly to: number };
  readonly blockMs: number;
  readonly offsetMs?: number;
}): PendingBlock[] => {
  const { window, ppm, near, blockMs } = input;
  const offset = input.offsetMs ?? 0;
  return input.days.flatMap((day) => {
    const end = Math.min(day.end, window.to);
    const blocks: PendingBlock[] = [];
    let left = Math.max(day.start, window.from);
    let cut = day.start + (offset > 0 ? offset : blockMs);
    while (cut <= left) cut += blockMs;
    while (left < end) {
      const right = Math.min(cut, end);
      const width = ((right - left) / MINUTE) * ppm - 4;
      if (right > near.from && left < near.to && width > 8) {
        blocks.push({ x: xOf(window, left, ppm) + 2, width });
      }
      left = right;
      cut = right + blockMs;
    }
    return blocks;
  });
};

/** A programme of a row with its times in milliseconds. */
export interface RowProgramme<P extends TimelineProgramme = GuideEntry> {
  readonly programme: P;
  readonly start: number;
  readonly end: number;
}

/**
 * The programmes of one row that the window shows, in start order: the cells `placeRow` lays
 * out, index for index. Ones outside the window and empty ones are dropped.
 */
export const rowInWindow = <P extends TimelineProgramme>(
  programmes: readonly P[],
  window: GuideWindow,
): readonly RowProgramme<P>[] =>
  programmes
    .map((programme) => ({
      programme,
      start: epochMs(programme.start),
      end: epochMs(programme.end),
    }))
    .filter(({ start, end }) => end > window.from && start < window.to && end > start)
    .toSorted((a, b) => a.start - b.start);

/**
 * Lays out one row's cells in pixels, in start order, with the markers that apply. Programmes
 * outside the window and empty ones are dropped; ones crossing an edge are cut there.
 */
export const placeRow = <P extends TimelineProgramme>(
  programmes: readonly P[],
  window: GuideWindow,
  now: number,
  ppm: number,
  marks: ReadonlyMap<string, ProgrammeMark>,
): readonly PlacedCell<P>[] =>
  rowInWindow(programmes, window).map(({ programme, start, end }) => {
    const from = Math.max(start, window.from);
    const to = Math.min(end, window.to);
    const width = Math.max(0, ((to - from) / MINUTE) * ppm - 4);
    return {
      programme,
      // Clamped to the window start: a programme that began earlier starts at the origin.
      x: Math.max(0, xOf(window, from, ppm)) + 2,
      width,
      when: end <= now ? "past" : start <= now ? "airing" : "future",
      progress: Math.min(1, Math.max(0, (now - start) / (end - start))),
      mark: marks.get(programme.id),
      size: width < microWidth ? "micro" : width < tinyWidth ? "tiny" : "full",
    };
  });

/** A ruler label every half hour, with whether the now chip covers it. */
export interface RulerTick {
  readonly at: number;
  readonly x: number;
  readonly half: boolean;
  readonly covered: boolean;
  /** At a midnight: the day that starts there, which the label names instead of 00:00. */
  readonly day?: GuideDay | undefined;
}

/**
 * The time ruler: a label each half hour. Labels the now chip would overlap are hidden (by
 * visibility, so nothing moves).
 */
export const rulerTicks = (
  window: GuideWindow,
  ppm: number,
  nowX: number | undefined,
  days: readonly GuideDay[] = [],
): readonly RulerTick[] => {
  const ticks: RulerTick[] = [];
  const starts = new Map(days.map((day) => [day.start, day]));
  // The window starts at a midnight, so every other label is a half hour.
  for (let at = window.from, index = 0; at < window.to; at += 30 * MINUTE, index += 1) {
    const x = xOf(window, at, ppm);
    ticks.push({
      at,
      x,
      half: index % 2 === 1,
      covered: nowX !== undefined && x + 50 > nowX - 30 && x < nowX + 28,
      day: starts.get(at),
    });
  }
  return ticks;
};
/** Where the grid scrolls to show `time`: 40 minutes of context before it. */
export const scrollLeftFor = (window: GuideWindow, time: number, ppm: number): number =>
  Math.max(0, xOf(window, time, ppm) - 40 * ppm);

/**
 * The part of a timeline grid that is drawn: rows `rowFrom` to `rowTo` (exclusive) and the
 * stretch `xFrom` to `xTo` of the cell area, px.
 */
export interface GridView {
  readonly rowFrom: number;
  readonly rowTo: number;
  readonly xFrom: number;
  readonly xTo: number;
}

/** Where a grid is scrolled to and how much of its cell area shows, px. */
export interface GridScroll {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What of a timeline grid to draw for a scroll position, so a guide of hundreds of channels and
 * a week of days draws about a screen: the rows in view and a few beyond, and the cells a
 * viewport's width either side. Both edges snap (rows to blocks of `overscan`, x to half
 * viewports), so scrolling changes the view only now and then, never every frame.
 */
export const gridView = (
  scroll: GridScroll,
  rowHeight: number,
  rowCount: number,
  overscan = 4,
): GridView => {
  const step = Math.max(1, Math.round(scroll.width / 2));
  const first = Math.floor(scroll.top / rowHeight) - overscan;
  const last = Math.ceil((scroll.top + scroll.height) / rowHeight) + overscan;
  return {
    rowFrom: Math.max(0, Math.floor(first / overscan) * overscan),
    rowTo: Math.min(rowCount, Math.ceil(last / overscan) * overscan),
    xFrom: Math.max(0, Math.floor((scroll.left - scroll.width) / step) * step),
    xTo: Math.ceil((scroll.left + 2 * scroll.width) / step) * step,
  };
};

/** Whether two views draw the same, so an unchanged view causes no render. */
export const sameGridView = (a: GridView, b: GridView): boolean =>
  a.rowFrom === b.rowFrom && a.rowTo === b.rowTo && a.xFrom === b.xFrom && a.xTo === b.xTo;

/**
 * The cells of a placed row (in start order, side by side) that reach into `xFrom`..`xTo`, as
 * the index of the first and one past the last. Found by halving, so a week of cells costs a
 * handful of steps.
 */
export const cellsInView = (
  cells: readonly Pick<PlacedCell, "x" | "width">[],
  xFrom: number,
  xTo: number,
): { readonly from: number; readonly to: number } => {
  // The first cell whose right edge reaches xFrom.
  let low = 0;
  let high = cells.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const cell = cells[middle] as Pick<PlacedCell, "x" | "width">;
    if (cell.x + cell.width < xFrom) low = middle + 1;
    else high = middle;
  }
  const from = low;
  // The first cell starting after xTo.
  high = cells.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((cells[middle]?.x ?? Number.POSITIVE_INFINITY) <= xTo) low = middle + 1;
    else high = middle;
  }
  return { from, to: low };
};
