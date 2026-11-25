import type { WindowCell } from "./core/index.ts";

/** Pixel geometry of the TV guide, derived from the mockup's em measurements. */
export interface GuideLayout {
  readonly em: number;
  /** Height of the focused-programme header above the grid. */
  readonly headerHeight: number;
  /** Left safe margin before the channel column. */
  readonly inset: number;
  readonly channelWidth: number;
  readonly rulerHeight: number;
  readonly rowHeight: number;
  /** Width of the scrolling time track right of the channel column. */
  readonly trackWidth: number;
  /** Rows that fit fully below the header and ruler (at least one). */
  readonly visibleRows: number;
  /** Track pixels per millisecond of programme time. */
  readonly pxPerMs: number;
  /** Space between neighbouring cells. */
  readonly gap: number;
  /** Narrowest width a focused cell grows to so its title is readable. */
  readonly focusMinWidth: number;
}

/**
 * Lays the guide out for a screen of `width` x `height` dp where one design unit is `em` dp,
 * showing `visibleSpan` ms of time across the track (`.guide-top`, `.g-row`, `.g-ruler`).
 */
export const guideLayout = (
  width: number,
  height: number,
  em: number,
  visibleSpan: number,
): GuideLayout => {
  const headerHeight = 15.5 * em;
  const inset = 4 * em;
  const channelWidth = 15 * em;
  const rulerHeight = 2.4 * em;
  const rowHeight = 4.3 * em;
  const trackWidth = Math.max(0, width - inset - channelWidth);
  const visibleRows = Math.max(1, Math.floor((height - headerHeight - rulerHeight) / rowHeight));
  return {
    em,
    headerHeight,
    inset,
    channelWidth,
    rulerHeight,
    rowHeight,
    trackWidth,
    visibleRows,
    pxPerMs: visibleSpan > 0 ? trackWidth / visibleSpan : 0,
    gap: 0.3 * em,
    focusMinWidth: 14 * em,
  };
};

/** Where a cell sits on the track, relative to the guide's time origin. */
export interface CellRect {
  readonly left: number;
  readonly width: number;
  /** Padding that keeps a clipped cell's title inside the viewport. */
  readonly textInset: number;
}

/**
 * The rectangle for a cell. Positions are measured from `origin` so they stay put while the
 * whole track scrolls on the UI thread; only the title inset follows the viewport.
 */
export const cellRect = (
  cell: WindowCell,
  layout: GuideLayout,
  origin: number,
  viewStart: number,
): CellRect => {
  const { start, end } = cell.programme;
  const left = (start - origin) * layout.pxPerMs;
  const natural = Math.max(0, (end - start) * layout.pxPerMs - layout.gap);
  const width = cell.focused ? Math.max(natural, layout.focusMinWidth) : natural;
  const hidden = cell.clippedStart ? (viewStart - start) * layout.pxPerMs : 0;
  // Leave the title at least 6 em of room before the cell's right end.
  const textInset = Math.max(0, Math.min(hidden, width - 6 * layout.em));
  return { left, width, textInset };
};

/** Short programmes drop their time line (under 20 minutes, as in the mockup). */
export const showsTimeLine = (cell: WindowCell): boolean =>
  cell.focused || cell.programme.end - cell.programme.start >= 20 * 60_000;
