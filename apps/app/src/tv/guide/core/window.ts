import type { GuideCursor } from "./cursor.ts";
import {
  ceilTo,
  firstEndingAfter,
  floorTo,
  type Guide,
  type GuideChannel,
  type GuideConfig,
  type GuideProgramme,
} from "./guide.ts";

/** How much to render beyond the viewport so scrolling never shows empty space. */
export interface WindowOptions {
  /** Extra rows above and below the viewport. */
  readonly rowOverscan: number;
  /** Extra time (ms) left and right of the viewport. */
  readonly timeOverscan: number;
}

/** Two rows and half a viewport width either side. */
export const defaultWindowOptions = (config: GuideConfig): WindowOptions => ({
  rowOverscan: 2,
  timeOverscan: config.visibleSpan / 2,
});

/** One programme cell to render. */
export interface WindowCell<P extends GuideProgramme = GuideProgramme> {
  readonly index: number;
  readonly programme: P;
  /** Starts before the viewport's left edge (drawn with a square left side). */
  readonly clippedStart: boolean;
  /** Ends after the viewport's right edge. */
  readonly clippedEnd: boolean;
  readonly focused: boolean;
}

/** One channel row to render with its cells inside the time window. */
export interface WindowRow<P extends GuideProgramme = GuideProgramme> {
  readonly row: number;
  readonly channel: GuideChannel<P>;
  readonly cells: readonly WindowCell<P>[];
}

/**
 * What to render: rows `[firstRow, lastRow)` and, per row, the programmes overlapping the time
 * range `[from, to)`. `ticks` are the slot boundaries inside that range, for the ruler.
 */
export interface GuideWindow<P extends GuideProgramme = GuideProgramme> {
  readonly firstRow: number;
  readonly lastRow: number;
  readonly from: number;
  readonly to: number;
  readonly ticks: readonly number[];
  readonly rows: readonly WindowRow<P>[];
}

/** Slot boundaries `t` with `from <= t < to`. */
export const slotTicks = (from: number, to: number, slot: number): readonly number[] => {
  const ticks: number[] = [];
  for (let tick = ceilTo(from, slot); tick < to; tick += slot) ticks.push(tick);
  return ticks;
};

/**
 * The part of the guide to render for the cursor's viewport plus overscan. Rendering only this
 * keeps a guide with hundreds of channels and a week of data cheap to draw.
 */
export const guideWindow = <P extends GuideProgramme>(
  guide: Guide<P>,
  config: GuideConfig,
  cursor: GuideCursor,
  options: WindowOptions = defaultWindowOptions(config),
): GuideWindow<P> => {
  const firstRow = Math.max(0, cursor.topRow - options.rowOverscan);
  const lastRow = Math.min(
    guide.channels.length,
    cursor.topRow + config.visibleRows + options.rowOverscan,
  );
  const from = floorTo(cursor.viewStart - options.timeOverscan, config.slot);
  const to = ceilTo(cursor.viewStart + config.visibleSpan + options.timeOverscan, config.slot);
  const viewEnd = cursor.viewStart + config.visibleSpan;
  const rows: WindowRow<P>[] = [];
  for (let row = firstRow; row < lastRow; row++) {
    const channel = guide.channels[row];
    if (channel === undefined) continue;
    const cells: WindowCell<P>[] = [];
    for (let index = firstEndingAfter(channel.programmes, from); ; index++) {
      const programme = channel.programmes[index];
      if (programme === undefined || programme.start >= to) break;
      cells.push({
        index,
        programme,
        clippedStart: programme.start < cursor.viewStart,
        clippedEnd: programme.end > viewEnd,
        focused: row === cursor.row && index === cursor.programme,
      });
    }
    rows.push({ row, channel, cells });
  }
  return { firstRow, lastRow, from, to, ticks: slotTicks(from, to, config.slot), rows };
};
