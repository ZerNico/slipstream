import { Link } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  type Ref,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cellsInView,
  type Channel,
  channelMark,
  displayChannelName,
  epochMs,
  type GridView,
  gridView,
  type GuideEntry,
  HOUR,
  type MarkState,
  MINUTE,
  type PendingBlock,
  pendingBlocks,
  placeRow,
  type ProgrammeMark,
  rowInWindow,
  sameGridView,
} from "@slipstream/domain";
import { formatClock, formatTimeRange } from "~/i18n/formats.ts";
import { getLocale, getRegion, getTimeZone, m } from "@slipstream/i18n";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";
import { ChannelMenu } from "./channel-menu.tsx";
import { cellLabel, cellTimeWords, dayHeading, daySentenceLabel, markWords } from "./labels.ts";
import {
  dayAt,
  type GuideCategory,
  type GuideDay,
  type GuideWindow,
  inCategory,
  initialPosition,
  moveInGrid,
  type NavCell,
  type NavPosition,
  type NavRows,
  type PlacedCell,
  rulerTicks,
  tickMinutes,
  firstClearTick,
  scrollLeftFor,
  visibleDayAt,
  windowWidth,
  xOf,
} from "./model.ts";

/**
 * One channel row of the grid: the channel and its programmes. The grid places the cells of the
 * rows it draws, so a clock tick re-places a screen of rows, not a thousand channels' week.
 */
export interface GridRow {
  readonly channel: Channel;
  readonly programmes: readonly GuideEntry[];
}

/** What the page can ask the grid to do: the Now and 20:15 jumps, the skip link. */
export interface TimelineGridHandle {
  /** Scrolls so `time` shows with some context before it. */
  readonly scrollToTime: (time: number, smooth: boolean) => void;
  /** Jumps to now and focuses the first programme on air. */
  readonly focusNow: () => void;
  /** Focuses the cell that takes Tab (the skip link's target). */
  readonly focusRoving: () => void;
  /** Shows the same time of day on another day: the day switcher's arrows and menu. */
  readonly showDay: (day: GuideDay) => void;
}

/** Scroll positions per guide (keyed by its first day), so leaving and coming back keeps the place. */
const savedScroll = new Map<string, { left: number; top: number }>();

/**
 * A row's cells for the arrow keys, kept per programme list (each answer's lists are new
 * objects, so a new answer is never read from here) and window.
 */
const navCache = new WeakMap<
  readonly GuideEntry[],
  { readonly range: GuideWindow; readonly cells: readonly NavCell[] }
>();
const navCellsOf = (programmes: readonly GuideEntry[], range: GuideWindow): readonly NavCell[] => {
  const known = navCache.get(programmes);
  if (known !== undefined && known.range === range) return known.cells;
  const cells = rowInWindow(programmes, range).map(({ programme, start, end }) => ({
    id: programme.id,
    start,
    end,
  }));
  navCache.set(programmes, { range, cells });
  return cells;
};

/** Placeholder blocks for even and odd rows; odd rows start half an hour later, like a wall. */
interface PendingBlocks {
  readonly even: readonly PendingBlock[];
  readonly odd: readonly PendingBlock[];
}

/**
 * A channel row's height and the time ruler's, px. The canvas hands them to its classes as
 * `--row-h` and `--ruler-h`, so the drawing and the maths never disagree.
 */
const rowHeight = 78;
const rulerHeight = 40;

/**
 * Half the now chip's width, px: once the chip's left half is under the channel column, chip
 * and line hide (the domain's `rulerTicks` clears ruler labels the same distance around it).
 */
const nowChipHalfWidth = 28;

/** Everything: what a grid without a layout draws (a test's DOM), having no screen to fill. */
const wholeGrid: GridView = {
  rowFrom: 0,
  rowTo: Number.MAX_SAFE_INTEGER,
  xFrom: 0,
  xTo: Number.POSITIVE_INFINITY,
};

/** The part of the grid to draw for the scroller's place and size. */
const viewAt = (
  place: { left: number; top: number },
  size: { width: number; height: number },
  channelWidth: number,
): GridView =>
  size.width === 0
    ? wholeGrid
    : gridView(
        {
          left: place.left,
          top: place.top,
          width: Math.max(1, size.width - channelWidth),
          height: Math.max(1, size.height - rulerHeight),
        },
        rowHeight,
        Number.MAX_SAFE_INTEGER,
      );

/**
 * Scrolls the grid to `left` smoothly. A long way (days ahead and back) first jumps to most of a
 * screen before the target and glides only the rest, so the browser never paints every day in
 * between.
 */
const glideTo = (element: HTMLElement, left: number) => {
  const width = element.clientWidth;
  const distance = left - element.scrollLeft;
  if (Math.abs(distance) > 1.5 * width) {
    element.scrollTo({ left: left - Math.sign(distance) * 0.75 * width, behavior: "auto" });
  }
  element.scrollTo({ left, behavior: "smooth" });
};

/**
 * The timeline (SPEC §8.2): one grid across every day of guide data, a midnight in the ruler
 * naming the day that starts there and the corner naming the day in view. Sticky channel column
 * and time ruler, rows of opaque cells, the red now line behind them with a now chip in the
 * ruler (both gone once now has scrolled under the channel column), titles that stay readable
 * while scrolling sideways, hatched micro cells, markers, and roving focus moved by the arrow
 * keys.
 */
export function TimelineGrid({
  ref,
  rows,
  marks,
  pendingDays,
  window: range,
  days,
  onVisibleDay,
  now,
  ppm,
  channelWidth,
  compact,
  category,
  initialTime,
  onOpen,
}: {
  ref?: Ref<TimelineGridHandle>;
  rows: readonly GridRow[];
  /** Recording markers by programme id. */
  marks: ReadonlyMap<string, ProgrammeMark>;
  /** Days whose programmes are not in yet: quiet blocks stand in their place. */
  pendingDays: readonly GuideDay[];
  window: GuideWindow;
  /** The guide's days, for the midnight labels, the corner and the cells' spoken day. */
  days: readonly GuideDay[];
  /** Hears the day in view whenever scrolling brings another one. */
  onVisibleDay: (day: GuideDay) => void;
  now: number;
  ppm: number;
  channelWidth: number;
  /** The narrow channel column: number and logo only, the name in the row's label. */
  compact: boolean;
  category: GuideCategory;
  /** Where the grid first scrolls when it has no saved position. */
  initialTime: number;
  onOpen: (programme: GuideEntry) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const width = windowWidth(range, ppm);
  const nowInWindow = now >= range.from && now < range.to;
  const nowX = nowInWindow ? xOf(range, now, ppm) : undefined;
  const scrollKey = days[0]?.key ?? "";
  // The day in view, for the corner; the page hears it too (the day switcher, 20:15).
  const [visibleDay, setVisibleDay] = useState<GuideDay | undefined>(undefined);
  const shownDay = visibleDay ?? dayAt(days, initialTime);
  const announce = useRef(onVisibleDay);
  const lastDay = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    announce.current = onVisibleDay;
  });
  // Now scrolled under the channel column: the line and its chip go, rather than show beside it.
  const [nowHidden, setNowHidden] = useState(false);
  // What is drawn: the rows in view and the cells about a screen either side, so hundreds of
  // channels over a week of days cost about a screen. Starts where the first scroll will land.
  const [view, setView] = useState<GridView>(() =>
    viewAt(
      savedScroll.get(scrollKey) ?? { left: scrollLeftFor(range, initialTime, ppm), top: 0 },
      // The window's size until the grid has its own, a little larger than the grid.
      { width: window.innerWidth, height: window.innerHeight },
      channelWidth,
    ),
  );

  // Each row's cells for the arrow keys, worked out when the keys (or the first Tab stop) reach
  // it: index for index the cells a row draws.
  const navRows = useMemo<NavRows>(
    () => ({
      length: rows.length,
      at: (index) => {
        const row = rows[index];
        return row === undefined ? undefined : navCellsOf(row.programmes, range);
      },
    }),
    [rows, range],
  );
  const ticks = useMemo(() => rulerTicks(range, ppm, nowX, days), [range, ppm, nowX, days]);
  const [roving, setRoving] = useState<NavPosition | undefined>(undefined);
  // The first ruler label whose start is clear of the sticky channel column.
  const [firstLabel, setFirstLabel] = useState(0);
  // Where the grid was before a click or a sheet: focus landing on a half-visible cell (the
  // click itself, or the sheet handing focus back) must not scroll the grid.
  const restore = useRef<{ left: number; top: number } | null>(null);
  const keepPlace = useCallback(() => {
    const element = scroller.current;
    if (element) restore.current = { left: element.scrollLeft, top: element.scrollTop };
  }, []);
  const opener = useRef(onOpen);
  useLayoutEffect(() => {
    opener.current = onOpen;
  });
  const openCell = useCallback(
    (programme: GuideEntry) => {
      keepPlace();
      opener.current(programme);
    },
    [keepPlace],
  );
  const focusedCell = useCallback((position: NavPosition) => {
    setRoving(position);
    const place = restore.current;
    if (place === null) return;
    restore.current = null;
    scroller.current?.scrollTo(place);
  }, []);
  const active = roving ?? initialPosition(navRows, now);

  const cellAt = (position: NavPosition | undefined) =>
    position === undefined
      ? null
      : (scroller.current?.querySelector<HTMLElement>(
          `[data-row="${position.row}"] [data-index="${position.index}"]`,
        ) ?? null);

  // The roving cell is always drawn (see `pinned`), so after this render it is in the DOM even
  // when it lies beyond what is in view.
  const focusCell = (position: NavPosition) => {
    flushSync(() => setRoving(position));
    const element = cellAt(position);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const scrollToTime = (time: number, smooth: boolean) => {
    const element = scroller.current;
    if (!element) return;
    const left = scrollLeftFor(range, time, ppm);
    if (smooth) glideTo(element, left);
    else element.scrollTo({ left, behavior: "auto" });
  };

  useImperativeHandle(ref, () => ({
    scrollToTime,
    showDay: (day) => {
      const element = scroller.current;
      if (!element) return;
      glideTo(
        element,
        element.scrollLeft + xOf(range, day.start, ppm) - xOf(range, shownDay.start, ppm),
      );
    },
    focusNow: () => {
      scrollToTime(now, true);
      const first = initialPosition(navRows, now);
      if (first) {
        flushSync(() => setRoving(first));
        cellAt(first)?.focus({ preventScroll: true });
      }
    },
    focusRoving: () => {
      const element = cellAt(active);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  }));

  // The first scroll: the saved place for this day, else the initial time. The sticky titles
  // read the scroll offset from one variable on the canvas, updated once per frame.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const saved = savedScroll.get(scrollKey);
    element.scrollLeft = saved?.left ?? scrollLeftFor(range, initialTime, ppm);
    element.scrollTop = saved?.top ?? 0;
    // Everything that follows the scroll position; each state re-renders only when it changes.
    const follow = () => {
      const left = element.scrollLeft;
      canvas.current?.style.setProperty("--sl", `${left}px`);
      setFirstLabel(firstClearTick(left, ppm));
      setNowHidden(nowX !== undefined && nowX - nowChipHalfWidth < left);
      const day = visibleDayAt(days, range, left, element.clientWidth - channelWidth, ppm);
      if (lastDay.current !== day.key) {
        lastDay.current = day.key;
        setVisibleDay(day);
        announce.current(day);
      }
      const next = viewAt(
        { left, top: element.scrollTop },
        { width: element.clientWidth, height: element.clientHeight },
        channelWidth,
      );
      setView((current) => (sameGridView(current, next) ? current : next));
    };
    follow();
    // A resized window shows more or fewer rows and hours.
    const resized = new ResizeObserver(() => follow());
    resized.observe(element);
    let frame = 0;
    const onScroll = () => {
      savedScroll.set(scrollKey, { left: element.scrollLeft, top: element.scrollTop });
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        follow();
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      resized.disconnect();
      window.cancelAnimationFrame(frame);
    };
    // Re-run per guide and zoom only; a new `now` must not jump the grid back.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey, ppm, range.to, channelWidth]);

  // Where days still load, within what is drawn and an hour beyond: hour-long blocks in the
  // skeleton's tone, so a far jump shows the guide loading there rather than empty rows.
  const pending = useMemo((): PendingBlocks => {
    const near = {
      from: range.from + (view.xFrom / ppm) * MINUTE - HOUR,
      to: range.from + (view.xTo / ppm) * MINUTE + HOUR,
    };
    const blocks = (offsetMs: number) =>
      pendingBlocks({ days: pendingDays, window: range, ppm, near, blockMs: HOUR, offsetMs });
    return { even: blocks(0), odd: blocks(HOUR / 2) };
  }, [pendingDays, range, ppm, view.xFrom, view.xTo]);

  // The rows to draw: those in view, and the roving cell's wherever it is, so Tab and the arrow
  // keys always find it.
  const drawn: number[] = [];
  const rowTo = Math.min(view.rowTo, rows.length);
  if (active !== undefined && active.row < view.rowFrom && active.row < rows.length) {
    drawn.push(active.row);
  }
  for (let index = view.rowFrom; index < rowTo; index++) drawn.push(index);
  if (active !== undefined && active.row >= rowTo && active.row < rows.length) {
    drawn.push(active.row);
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement;
    const row = Number(target.closest<HTMLElement>("[data-row]")?.dataset["row"]);
    const index = Number(target.dataset["index"]);
    if (!Number.isInteger(row) || !Number.isInteger(index)) return;
    const next = moveInGrid(navRows, { row, index }, event.key, now, range.from);
    if (event.key.startsWith("Arrow")) event.preventDefault();
    if (next) focusCell(next);
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-line ring-inset short:rounded-md">
      <div
        ref={scroller}
        id="guide-grid"
        className="absolute inset-0 overflow-auto overscroll-contain [scrollbar-width:thin]"
        role="region"
        aria-label={m.guide_region_label()}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div
          ref={canvas}
          className="relative"
          style={
            {
              width: width + channelWidth,
              "--chw": `${channelWidth}px`,
              "--row-h": `${rowHeight}px`,
              "--ruler-h": `${rulerHeight}px`,
            } as CSSProperties
          }
        >
          {/* First, so rows that come and go never change its place in the tree. */}
          {nowX === undefined ? null : (
            <div
              className={cn(
                "pointer-events-none absolute top-(--ruler-h) bottom-0 z-[1] -ml-px w-0.5 bg-live",
                nowHidden && "invisible",
              )}
              style={{ left: channelWidth + nowX }}
              aria-hidden="true"
            />
          )}
          <div className="sticky top-0 z-[4] flex h-(--ruler-h) border-b border-line bg-surface">
            <div
              className="sticky left-0 z-[3] flex w-(--chw) flex-none items-center border-r border-line bg-surface pl-3.5 type-meta"
              data-visible-day={shownDay.key}
            >
              {dayHeading(shownDay)}
            </div>
            <div className="relative flex-none" style={{ width }} aria-hidden="true">
              {ticks.map((tick, index) => (
                <span
                  key={tick.at}
                  data-ruler-tick=""
                  data-day={tick.day?.key}
                  className={cn(
                    "absolute top-0 flex h-(--ruler-h) items-center border-l pl-2.5 text-[12.5px] text-fg-3 tabular-nums transition-opacity duration-150",
                    tick.day
                      ? "border-line-2 font-semibold text-fg"
                      : tick.half
                        ? "border-l-transparent font-medium"
                        : "border-line font-semibold",
                    tick.covered && "invisible",
                    // A label whose start is under the sticky channel column would show cut.
                    index < firstLabel && "opacity-0",
                  )}
                  style={{ left: tick.x, width: tickMinutes * ppm }}
                >
                  {tick.day ? (
                    // A midnight names the day that starts there.
                    <span className="rounded-full bg-raised px-2 py-0.5 whitespace-nowrap">
                      {dayHeading(tick.day)}
                    </span>
                  ) : (
                    formatClock(tick.at)
                  )}
                </span>
              ))}
              {nowX === undefined ? null : (
                <b
                  className={cn(
                    "absolute top-[9px] z-[2] -translate-x-1/2 rounded-[6px] bg-live-solid px-[7px] py-[3px] text-[12px] leading-4 font-[750] text-on-live tabular-nums",
                    nowHidden && "invisible",
                  )}
                  style={{ left: nowX }}
                >
                  {formatClock(now)}
                </b>
              )}
            </div>
          </div>

          {/* Every row's place, drawn or not; the drawn ones sit at theirs. */}
          <div className="relative" style={{ height: rows.length * rowHeight }}>
            {drawn.map((rowIndex) => (
              <GridRowView
                key={rows[rowIndex]?.channel.id}
                row={rows[rowIndex] as GridRow}
                rowIndex={rowIndex}
                tabbable={active?.row === rowIndex ? active.index : undefined}
                xFrom={view.xFrom}
                xTo={view.xTo}
                pending={rowIndex % 2 === 0 ? pending.even : pending.odd}
                range={range}
                now={now}
                ppm={ppm}
                marks={marks}
                width={width}
                days={days}
                compact={compact}
                category={category}
                onCellFocus={focusedCell}
                onCellPointerDown={keepPlace}
                onCellOpen={openCell}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One channel row: the sticky channel cell and its programmes between `xFrom` and `xTo` (and
 * the tabbable one wherever it is). Its own component, so a grid render (scrolling, focus
 * moving) redraws only the rows whose props changed.
 */
function GridRowView({
  row,
  rowIndex,
  tabbable,
  xFrom,
  xTo,
  pending,
  range,
  now,
  ppm,
  marks,
  width,
  days,
  compact,
  category,
  onCellFocus,
  onCellPointerDown,
  onCellOpen,
}: {
  row: GridRow;
  rowIndex: number;
  /** The index of the cell in this row that takes Tab, if it is in this row. */
  tabbable: number | undefined;
  /** The stretch of the cell area that is drawn, px. */
  xFrom: number;
  xTo: number;
  /** Placeholder blocks where days still load, for this row's parity. */
  pending: readonly PendingBlock[];
  range: GuideWindow;
  now: number;
  ppm: number;
  marks: ReadonlyMap<string, ProgrammeMark>;
  width: number;
  days: readonly GuideDay[];
  compact: boolean;
  category: GuideCategory;
  onCellFocus: (position: NavPosition) => void;
  onCellPointerDown: () => void;
  onCellOpen: (programme: GuideEntry) => void;
}) {
  const { channel } = row;
  const name = displayChannelName(channel.name);
  const cells = useMemo(
    () => placeRow(row.programmes, range, now, ppm, marks),
    [row.programmes, range, now, ppm, marks],
  );
  const shown = cellsInView(cells, xFrom, xTo);
  const indexes: number[] = [];
  if (tabbable !== undefined && tabbable < shown.from) indexes.push(tabbable);
  for (let index = shown.from; index < shown.to; index++) indexes.push(index);
  if (tabbable !== undefined && tabbable >= shown.to && tabbable < cells.length) {
    indexes.push(tabbable);
  }
  return (
    <div
      className="absolute inset-x-0 flex h-(--row-h) border-b border-line"
      style={{ top: rowIndex * rowHeight }}
      data-row={rowIndex}
    >
      <ChannelMenu channel={channel}>
        <Link
          to="/watch/live/$channel"
          params={{ channel: channel.id }}
          tabIndex={-1}
          aria-label={m.guide_watch_channel_live({ channel: channel.name })}
          className={cn(
            "sticky left-0 z-[3] flex w-(--chw) min-w-0 flex-none items-center border-r border-line bg-surface text-left text-[14px] font-semibold transition-colors duration-(--t-fast) hover:bg-raised",
            compact ? "gap-2 pr-2 pl-2.5" : "gap-3 pr-3 pl-3.5",
          )}
        >
          <Sk className="w-4 flex-none text-[12px] text-fg-3 tabular-nums" chars={1}>
            {channel.number === undefined ? "" : String(channel.number)}
          </Sk>
          <ChannelLogo
            mark={channelMark(channel.name)}
            {...(channel.logoUrl ? { logoUrl: channel.logoUrl } : {})}
          />
          <Sk className={cn("min-w-0 flex-1 truncate", compact && "sr-only")} chars={9}>
            {name}
          </Sk>
        </Link>
      </ChannelMenu>
      <div
        className="relative z-[2] flex-none [clip-path:inset(-8px_-8px_-8px_0)]"
        style={{ width }}
        data-track=""
      >
        {pending.map((block) => (
          <span
            key={block.x}
            aria-hidden="true"
            className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-[10px] bg-(--sk)"
            style={{ left: block.x, width: block.width }}
          />
        ))}
        {indexes.map((index) => {
          const cell = cells[index] as PlacedCell;
          return (
            <GridCell
              key={cell.programme.id}
              cell={cell}
              row={rowIndex}
              index={index}
              tabbable={tabbable === index}
              channelLabel={name}
              days={days}
              dim={!inCategory(cell.programme, category)}
              onFocus={onCellFocus}
              onPointerDown={onCellPointerDown}
              onOpen={onCellOpen}
            />
          );
        })}
      </div>
    </div>
  );
}

const markRing: Record<MarkState, string> = {
  recording: "shadow-[inset_0_0_0_1.5px_var(--live)]",
  scheduled: "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--brand)_70%,transparent)]",
  conflict: "shadow-[inset_0_0_0_1.5px_var(--warn)]",
  // An episode the viewer already has stays quiet: the check alone, no ring.
  repeat: "",
};

/**
 * The 8 px marker before a title: red pulsing, amber ring, orange, or a neutral check for an
 * episode the viewer already has. The check is drawn over the same 8 px slot, so a cell keeps
 * its geometry whichever marker it carries.
 */
export function MarkDot({ state, className }: { state: MarkState; className?: string }) {
  if (state === "repeat") {
    return (
      <i
        aria-hidden="true"
        data-mark-check=""
        className={cn("relative size-2 flex-none text-fg-3", className)}
      >
        <Icon
          icon={CheckIcon}
          size={14}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        />
      </i>
    );
  }
  return (
    <i
      aria-hidden="true"
      className={cn(
        "size-2 flex-none rounded-full",
        state === "recording" && "bg-live",
        state === "scheduled" && "shadow-[inset_0_0_0_2px_var(--brand)]",
        state === "conflict" && "bg-warn",
        className,
      )}
    />
  );
}

interface GridCellProps {
  cell: PlacedCell;
  row: number;
  index: number;
  tabbable: boolean;
  /** The row's channel, first in the spoken label. */
  channelLabel: string;
  days: readonly GuideDay[];
  dim: boolean;
  onFocus: (position: NavPosition) => void;
  onPointerDown: () => void;
  onOpen: (programme: GuideEntry) => void;
}

/** A programme's times as its cell writes and speaks them, in one language, region and zone. */
interface CellTimes {
  readonly language: string;
  readonly range: string;
  readonly spoken: string;
}

/**
 * Formatted times per programme: formatting is the dearest part of drawing a cell, and a day
 * scrolled back to draws the same programmes (each answer keeps its objects) again.
 */
const timesCache = new WeakMap<GuideEntry, CellTimes>();
const cellTimes = (programme: GuideEntry): CellTimes => {
  const language = `${getLocale()}|${getRegion() ?? ""}|${getTimeZone() ?? ""}`;
  const known = timesCache.get(programme);
  if (known !== undefined && known.language === language) return known;
  const times = {
    language,
    range: formatTimeRange(epochMs(programme.start), epochMs(programme.end)),
    spoken: cellTimeWords(programme),
  };
  timesCache.set(programme, times);
  return times;
};

/** Whether two markers say the same (each new answer builds them anew). */
const sameMark = (a: ProgrammeMark | undefined, b: ProgrammeMark | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.state === b.state &&
    a.recordingId === b.recordingId &&
    a.ruleId === b.ruleId &&
    // A repeat's copy comes from the repeats answer, which keeps its objects while it holds.
    (a.state !== "repeat" || (b.state === "repeat" && a.of === b.of)));

/**
 * Whether a cell draws the same: a day's answer arriving or the clock ticking places every
 * drawn row again (new cell objects), and a cell formats its times and words when it renders,
 * so only cells whose programme, place, state or marker changed render again.
 */
const sameGridCell = (before: GridCellProps, after: GridCellProps): boolean =>
  before.cell.programme === after.cell.programme &&
  before.cell.x === after.cell.x &&
  before.cell.width === after.cell.width &&
  before.cell.when === after.cell.when &&
  before.cell.size === after.cell.size &&
  sameMark(before.cell.mark, after.cell.mark) &&
  // The progress tint moves only while it airs.
  (after.cell.when !== "airing" || before.cell.progress === after.cell.progress) &&
  before.row === after.row &&
  before.index === after.index &&
  before.tabbable === after.tabbable &&
  before.channelLabel === after.channelLabel &&
  before.days === after.days &&
  before.dim === after.dim &&
  before.onFocus === after.onFocus &&
  before.onPointerDown === after.onPointerDown &&
  before.onOpen === after.onOpen;

const GridCell = memo(function GridCell({
  cell,
  row,
  index,
  tabbable,
  channelLabel,
  days,
  dim,
  onFocus,
  onPointerDown,
  onOpen,
}: GridCellProps) {
  const { programme } = cell;
  const start = epochMs(programme.start);
  const times = cellTimes(programme);
  const range = times.range;
  const label = cellLabel(channelLabel, programme, cell.mark, {
    day: daySentenceLabel(dayAt(days, start)),
    when: cell.when,
    time: times.spoken,
  });
  // The tooltip says what the marker means, as the spoken label does ("already scheduled").
  const title = [`${programme.title} · ${range}`, ...(cell.mark ? markWords(cell.mark) : [])].join(
    " · ",
  );
  const style = {
    left: cell.x,
    width: cell.width,
    "--x": `${cell.x}px`,
    "--w": `${cell.width}px`,
    "--p": `${cell.progress * 100}%`,
  } as CSSProperties;
  return (
    <button
      type="button"
      data-index={index}
      data-programme={programme.id}
      data-start={start}
      data-when={cell.when}
      data-mark={cell.mark?.state}
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      title={title}
      className={cn(
        "absolute top-1.5 bottom-1.5 grid min-w-0 content-center gap-0.5 overflow-clip rounded-[10px] py-[9px] pr-3 text-left transition-[background-color,box-shadow,opacity] duration-(--t-fast) focus-visible:z-[3] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus",
        // A cell scrolled under the channel column keeps its words in view. They slide by a
        // transform and narrow (never a padding), so scrolling the grid moves no box.
        "[--off:clamp(0px,var(--sl,0px)-var(--x),var(--w)-96px)] pl-[var(--pad,12px)] *:max-w-[calc(100%-var(--off))] *:translate-x-(--off)",
        cell.when === "past"
          ? "bg-transparent shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover"
          : cell.when === "airing"
            ? "bg-[color-mix(in_oklab,var(--raised),var(--fg)_5%)] before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-(--p) before:bg-[color-mix(in_oklab,var(--live)_7%,transparent)] hover:bg-[color-mix(in_oklab,var(--raised),var(--fg)_9%)]"
            : "bg-raised hover:bg-[color-mix(in_oklab,var(--raised),var(--fg)_8%)]",
        cell.mark && markRing[cell.mark.state],
        cell.size === "tiny" && "pr-1.5 [--pad:6px]",
        cell.size === "micro" &&
          "p-0 after:absolute after:-inset-x-[3px] after:-inset-y-1.5 *:hidden",
        dim && "opacity-[.28]",
      )}
      style={style}
      onFocus={() => onFocus({ row, index })}
      onPointerDown={onPointerDown}
      onClick={() => onOpen(programme)}
    >
      <span
        className={cn(
          "relative flex min-w-0 items-center gap-1.5 text-[13.5px] whitespace-nowrap",
          cell.when === "past" ? "font-[550] text-fg-3" : "font-semibold",
        )}
      >
        {cell.mark ? <MarkDot state={cell.mark.state} /> : null}
        <span className="truncate">{programme.title}</span>
      </span>
      <span
        className={cn(
          "relative truncate text-[12px] text-fg-2 tabular-nums",
          cell.size === "tiny" && "hidden",
        )}
      >
        {programme.subtitle ? `${range} · ${programme.subtitle}` : range}
      </span>
    </button>
  );
}, sameGridCell);
