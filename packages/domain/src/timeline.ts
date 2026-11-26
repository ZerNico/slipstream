import type { GuideEntry } from "./programme.ts";
import { epochMs } from "./time.ts";

/**
 * Pure geometry for the timeline (SPEC §5), shared by web and app: the bar, its programme
 * bands and ticks, the labels and seeking. Times are epoch milliseconds; positions are
 * percentages of the bar, 0 at `start` and 100 at `end`. Each client draws exactly this.
 */

/** A closed time range in epoch milliseconds. */
export interface TimeSpan {
  readonly start: number;
  readonly end: number;
}

/** One programme band: where it runs and what it is called. */
export interface Band extends TimeSpan {
  readonly title: string;
}

/** Everything the bar shows, as plain data. */
export interface TimelineData {
  /** Left edge of the bar: the recording window's start (extra time included). */
  readonly start: number;
  /** Right edge: the window's end, extra time included. */
  readonly end: number;
  /** What has been captured so far. Absent when nothing has been recorded yet. */
  readonly captured?: TimeSpan;
  /** Where the source dropped out. Only the parts inside `captured` are drawn. */
  readonly gaps?: readonly TimeSpan[];
  /** Programme start and end ticks from the guide, drawn above the track. */
  readonly marks?: readonly number[];
  /** Your position. Absent when you have none: then there is no amber knob (SPEC §3.1). */
  readonly playhead?: number;
  /** The live edge while capture is running; absent once it has finished. */
  readonly live?: number;
  /**
   * The wall clock when a channel is on air but nothing records it yet (hero "Starts soon"): a
   * still red dot and a `Now` label, dashes from here to the end.
   */
  readonly now?: number;
  /** Every guide programme inside the window, drawn as labelled bands above the track. */
  readonly bands?: readonly Band[];
}

/** A run along the bar in percent. */
export interface Segment {
  readonly left: number;
  readonly width: number;
}

/** A band laid out, with whether it is the programme you are in (or that is on now). */
export interface BandLayout extends Segment {
  readonly title: string;
  readonly current: boolean;
}

/** The bar, laid out. Every position is clamped to the bar. */
export interface TimelineLayout {
  /** The flat track: what already aired, captured or not. */
  readonly aired: Segment | undefined;
  readonly captured: Segment | undefined;
  readonly played: Segment | undefined;
  /** The dashed part not aired yet: from live (or now) to the end, or all when nothing aired. */
  readonly upcoming: Segment | undefined;
  /** The amber band from your position to the live edge: how far behind you are. */
  readonly behind: Segment | undefined;
  readonly gaps: readonly Segment[];
  readonly marks: readonly number[];
  readonly bands: readonly BandLayout[];
  readonly playhead: number | undefined;
  readonly live: number | undefined;
  readonly now: number | undefined;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The bar with its right edge moved out to whatever went past the planned end: a programme that
 * overruns, a capture still running after the window, a position beyond it. The bar grows
 * instead of pinning everything at 100 %.
 */
export const withOverrun = (data: TimelineData): TimelineData => {
  const end = Math.max(
    data.end,
    data.live ?? data.end,
    data.captured?.end ?? data.end,
    data.playhead ?? data.end,
  );
  return end === data.end ? data : { ...data, end };
};

/** Where `time` sits on the bar, 0 to 100. A bar with no length puts everything at 0. */
export const positionOf = (data: Pick<TimelineData, "start" | "end">, time: number): number => {
  const length = data.end - data.start;
  if (!(length > 0)) return 0;
  return clamp(((time - data.start) / length) * 100, 0, 100);
};

const segmentOf = (data: TimelineData, span: TimeSpan): Segment | undefined => {
  const left = positionOf(data, span.start);
  const right = positionOf(data, span.end);
  return right > left ? { left, width: right - left } : undefined;
};

/** The overlap of two spans, or undefined when they don't touch. */
const intersect = (a: TimeSpan, b: TimeSpan): TimeSpan | undefined => {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : undefined;
};

/** Gaps clipped to the captured range, sorted, with overlapping ones merged. */
const mergedGaps = (gaps: readonly TimeSpan[], captured: TimeSpan): TimeSpan[] => {
  const clipped = gaps
    .map((gap) => intersect(gap, captured))
    .filter((gap): gap is TimeSpan => gap !== undefined)
    .toSorted((a, b) => a.start - b.start);
  const merged: TimeSpan[] = [];
  for (const gap of clipped) {
    const last = merged.at(-1);
    if (last && gap.start <= last.end)
      merged[merged.length - 1] = { ...last, end: Math.max(last.end, gap.end) };
    else merged.push(gap);
  }
  return merged;
};

/** Lays out every part of the bar from plain data. */
export const layoutTimeline = (data: TimelineData): TimelineLayout => {
  const { captured } = data;
  const playedEnd =
    captured && data.playhead !== undefined
      ? clamp(data.playhead, captured.start, captured.end)
      : undefined;
  // Not aired yet: from the live edge, else from now, else all of it when nothing has aired.
  const airedUntil = data.live ?? data.now ?? (captured === undefined ? data.start : data.end);
  const upcomingSpan: TimeSpan | undefined =
    airedUntil < data.end ? { start: airedUntil, end: data.end } : undefined;
  const reference = data.playhead ?? data.live ?? data.now;
  return {
    aired: segmentOf(data, { start: data.start, end: airedUntil }),
    captured: captured && segmentOf(data, captured),
    played:
      captured && playedEnd !== undefined
        ? segmentOf(data, { start: captured.start, end: playedEnd })
        : undefined,
    upcoming: upcomingSpan && segmentOf(data, upcomingSpan),
    behind:
      data.live !== undefined && playedEnd !== undefined && data.live > playedEnd
        ? segmentOf(data, { start: playedEnd, end: data.live })
        : undefined,
    gaps: captured
      ? mergedGaps(data.gaps ?? [], captured)
          .map((gap) => segmentOf(data, gap))
          .filter((gap): gap is Segment => gap !== undefined)
      : [],
    marks: (data.marks ?? [])
      .filter((mark) => mark > data.start && mark < data.end)
      .map((mark) => positionOf(data, mark)),
    bands: (data.bands ?? [])
      .map((band): BandLayout | undefined => {
        const segment = segmentOf(data, band);
        return (
          segment && {
            ...segment,
            title: band.title,
            current: reference !== undefined && band.start <= reference && reference < band.end,
          }
        );
      })
      .filter((band): band is BandLayout => band !== undefined),
    playhead: data.playhead === undefined ? undefined : positionOf(data, data.playhead),
    live: data.live === undefined ? undefined : positionOf(data, data.live),
    now: data.live === undefined && data.now !== undefined ? positionOf(data, data.now) : undefined,
  };
};

/** How a label hangs from its point: centred, or inwards near an edge. */
export type LabelAlign = "start" | "center" | "end";

/** A label above or below the track. */
export interface PlacedLabel {
  readonly left: number;
  readonly align: LabelAlign;
  readonly visible: boolean;
}

/** Everything the label rows show; hidden labels keep their row (visibility, never layout). */
export interface TimelineLabels {
  /** `● LIVE 18:42` at the live edge. */
  readonly live: PlacedLabel | undefined;
  /** Your time at the knob; hidden when it would crowd the live label. */
  readonly here: PlacedLabel | undefined;
  /** `Now 18:42` at a still now marker. */
  readonly now: PlacedLabel | undefined;
  /** Window start (or `0:00`) and end (or the duration). */
  readonly start: PlacedLabel;
  readonly end: PlacedLabel;
}

/** Your time label hides when it is closer than this to the live label, in percent (SPEC §5). */
export const hereLabelMinGap = 14;

/** A bottom label hides when the knob, the live dot or the now dot is this close, px (issue #32). */
export const bottomLabelClearance = 28;

const alignAt = (left: number, startBelow: number, endAbove: number): LabelAlign =>
  left < startBelow ? "start" : left > endAbove ? "end" : "center";

/**
 * Widths the top labels take at most, px: "18:11" and "● LIVE 18:42" in the 12 px label type.
 * With the bar measured, your time hides when the two would come closer than 8 px.
 */
export const topLabelWidths = { here: 44, live: 92 } as const;

/** The span a label covers along the bar, px. */
const extent = (left: number, align: LabelAlign, width: number, barWidth: number) => {
  const x = (left / 100) * barWidth;
  return align === "start"
    ? { from: x, to: x + width }
    : align === "end"
      ? { from: x - width, to: x }
      : { from: x - width / 2, to: x + width / 2 };
};

/** Whether your time label stays clear of the live label. */
const hereClear = (here: number, live: number | undefined, barWidth: number | undefined) => {
  if (live === undefined) return true;
  if (barWidth === undefined) return Math.abs(live - here) >= hereLabelMinGap;
  const a = extent(here, alignAt(here, 8, 92), topLabelWidths.here, barWidth);
  const b = extent(live, alignAt(live, 10, 88), topLabelWidths.live, barWidth);
  return a.to + 8 <= b.from || b.to + 8 <= a.from;
};

/**
 * Places the labels (SPEC §5, open issue #32). `barWidth` is the bar's width in px once
 * measured; until then the bottom labels stay visible.
 */
export const placeLabels = (layout: TimelineLayout, barWidth?: number): TimelineLabels => {
  const dots = [layout.playhead, layout.live, layout.now].filter(
    (dot): dot is number => dot !== undefined,
  );
  const clear = (edge: 0 | 100) =>
    barWidth === undefined ||
    dots.every((dot) => (Math.abs(dot - edge) / 100) * barWidth >= bottomLabelClearance);
  return {
    live:
      layout.live === undefined
        ? undefined
        : { left: layout.live, align: alignAt(layout.live, 10, 88), visible: true },
    here:
      layout.playhead === undefined
        ? undefined
        : {
            left: layout.playhead,
            align: alignAt(layout.playhead, 8, 92),
            visible: hereClear(layout.playhead, layout.live, barWidth),
          },
    now:
      layout.now === undefined
        ? undefined
        : { left: layout.now, align: alignAt(layout.now, 10, 88), visible: true },
    start: { left: 0, align: "start", visible: clear(0) },
    end: { left: 100, align: "end", visible: clear(100) },
  };
};

/** The furthest you can seek to: the live edge while live, else the end of what was captured. */
const seekableSpan = (data: TimelineData): TimeSpan | undefined =>
  data.captured && {
    start: data.captured.start,
    end: data.live === undefined ? data.captured.end : Math.min(data.live, data.captured.end),
  };

/**
 * The time under a point `fraction` (0 to 1) along the bar, held inside what can be played:
 * nothing before the captured start, nothing past live. Undefined when nothing is captured.
 */
export const seekTimeAt = (data: TimelineData, fraction: number): number | undefined => {
  const span = seekableSpan(data);
  if (!span) return undefined;
  const time = data.start + clamp(fraction, 0, 1) * (data.end - data.start);
  return clamp(time, span.start, span.end);
};

/** `time` moved by `deltaMs`, held inside what can be played. */
export const seekBy = (data: TimelineData, time: number, deltaMs: number): number | undefined => {
  const span = seekableSpan(data);
  return span && clamp(time + deltaMs, span.start, span.end);
};

/** Within this of the live edge, the hover tooltip says "Live" (SPEC §5), ms. */
export const liveSnapMs = 60_000;

/** What the hover marker points at. */
export interface HoverInfo {
  /** The time under the pointer (not clamped to what can be played). */
  readonly time: number;
  /** Played already, at the live edge, or not aired yet. */
  readonly kind: "past" | "live" | "future";
  /** How far behind live that point is, ms (past only). */
  readonly behindMs: number | undefined;
  /** The programme band under the pointer, if any. */
  readonly band: string | undefined;
}

/** What is under a point `fraction` along the bar, for the hover tooltip and its marker. */
export const hoverAt = (data: TimelineData, fraction: number): HoverInfo => {
  const time = data.start + clamp(fraction, 0, 1) * (data.end - data.start);
  const edge = data.live ?? data.now;
  const band = data.bands?.find((candidate) => candidate.start <= time && time < candidate.end);
  const kind =
    edge === undefined
      ? "past"
      : time > edge
        ? "future"
        : edge - time <= liveSnapMs
          ? "live"
          : "past";
  return {
    time,
    kind,
    behindMs: kind === "past" && edge !== undefined ? edge - time : undefined,
    band: band?.title,
  };
};

/**
 * A band's name on the timeline: the programme without the series prefix and the event suffix,
 * "Qualifying" for "Live F1: Qualifying - GP Katar". Titles without either stay whole.
 */
export const bandTitle = (title: string): string => {
  const afterPrefix = title.includes(": ") ? title.slice(title.indexOf(": ") + 2) : title;
  const dash = afterPrefix.lastIndexOf(" - ");
  return dash > 0 ? afterPrefix.slice(0, dash) : afterPrefix;
};

/** The timeline's bands: the channel's programmes inside the window, in order, named short. */
export const bandsIn = (
  programmes: readonly Pick<GuideEntry, "channelId" | "start" | "end" | "title">[],
  channelId: GuideEntry["channelId"],
  start: number,
  end: number,
): Band[] =>
  programmes
    .filter(
      (programme) =>
        programme.channelId === channelId &&
        epochMs(programme.end) > start &&
        epochMs(programme.start) < end,
    )
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start))
    .map((programme) => ({
      start: epochMs(programme.start),
      end: epochMs(programme.end),
      title: bandTitle(programme.title),
    }));

/**
 * The ticks on the bar: where one band ends and the next begins, and any further marks (a
 * recording's programme start and end inside its extra time), once each and in order. Ticks at
 * or past the bar's ends are dropped by `layoutTimeline`.
 */
export const bandTicks = (
  bands: readonly TimeSpan[],
  marks: readonly number[] = [],
): readonly number[] =>
  [...new Set([...bands.flatMap((band) => [band.start, band.end]), ...marks])].toSorted(
    (a, b) => a - b,
  );

/** Arrow keys step 10 s, Shift or Page keys 60 s (SPEC §5). */
export const keyStepMs = { small: 10_000, large: 60_000 } as const;

/**
 * Where a key moves the playhead: ←/→ ±10 s, Shift+←/→ and PgUp/PgDn ±60 s, Home to the start
 * of the programme (or of what was captured), End to live. Undefined for other keys.
 */
export const seekForKey = (
  data: TimelineData,
  current: number,
  key: string,
  shift: boolean,
  programmeStart?: number,
): number | undefined => {
  const span = seekableSpan(data);
  if (!span) return undefined;
  const step = shift ? keyStepMs.large : keyStepMs.small;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return seekBy(data, current, -step);
    case "ArrowRight":
    case "ArrowUp":
      return seekBy(data, current, step);
    case "PageDown":
      return seekBy(data, current, -keyStepMs.large);
    case "PageUp":
      return seekBy(data, current, keyStepMs.large);
    case "Home":
      return clamp(programmeStart ?? span.start, span.start, span.end);
    case "End":
      return span.end;
    default:
      return undefined;
  }
};
