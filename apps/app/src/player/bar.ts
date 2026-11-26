import type { RecordingEntry } from "@slipstream/api";
import {
  type Band,
  bandsIn,
  bandTicks,
  bandTitle,
  epochMs,
  type GuideEntry,
  type LabelAlign,
  layoutTimeline,
  type PlacedLabel,
  liveEta,
  padRange,
  placeLabels,
  playbackEndsAt,
  programmeAt,
  recordingGapSummary,
  rowsByChannel,
  seekTimeAt,
  type TimelineData,
  type TimelineLayout,
} from "@slipstream/domain";
import { formatters, m, type PlayerReadout, playerReadout } from "@slipstream/i18n";
import type { PlayTarget } from "./playback.ts";
import { behindLive, type PlayerProgress } from "./seek.ts";

/*
 * The player's timeline on phone and TV, laid out by the web's shared geometry (`layoutTimeline`,
 * `placeLabels`, `bandsIn`). This maps react-native-video's positions (seconds from the oldest
 * segment the playlist lists) onto the wall-clock bar and back.
 */

/** What the bar is drawn from. */
export interface BarInput {
  readonly target: PlayTarget;
  readonly progress: PlayerProgress | undefined;
  readonly now: number;
  /** The recording that plays (with its extra time), when one does. */
  readonly recording: RecordingEntry | undefined;
  /** Whether the recording is still being captured: then it has a live edge. */
  readonly running: boolean;
  /** The channel's guide around now. */
  readonly programmes: readonly GuideEntry[];
  /** Where the knob sits, seconds into the playlist (a drag, a scrub, a seek still loading). */
  readonly at: number | undefined;
}

/** The bar, and the way between positions on it and playlist seconds. */
export interface PlayerBar {
  readonly data: TimelineData;
  readonly layout: TimelineLayout;
  /** Positions count from the start ("0:00" to the length), not on the wall clock. */
  readonly relative: boolean;
  /** Share of the bar, 0 to 1, of a playlist position in seconds. */
  readonly share: (seconds: number) => number;
  /** The playlist position under a share of the bar, held inside what can be played. */
  readonly seekAt: (fraction: number) => number | undefined;
}

const seekableOf = (progress: PlayerProgress | undefined): number =>
  progress !== undefined &&
  Number.isFinite(progress.seekableDuration) &&
  progress.seekableDuration > 0
    ? progress.seekableDuration
    : 0;

/** The recording's own band and its slot's ticks, with the guide's neighbours in its extra time. */
const recordingBands = (
  recording: RecordingEntry,
  programmes: readonly GuideEntry[],
  start: number,
  end: number,
): readonly Band[] => {
  const own: Band = {
    start: epochMs(recording.start),
    end: epochMs(recording.end),
    title: bandTitle(recording.title),
  };
  const around = bandsIn(programmes, recording.channelId, start, end).filter(
    (band) => band.end <= own.start || band.start >= own.end,
  );
  return [...around, own].toSorted((a, b) => a.start - b.start);
};

/**
 * Lays out the bar. Live runs from the oldest second the pause buffer holds to the end of the
 * programme on air at the live edge, so you see what comes in it; a recording spans its window
 * with the extra time, captured up to the live edge while it runs; a finished recording and a
 * captured range span what plays, counted from 0:00.
 */
export const playerBar = (input: BarInput): PlayerBar => {
  const { target, recording } = input;
  const seekable = seekableOf(input.progress);
  const padded = recording === undefined ? undefined : padRange(recording, recording.padding);
  const windowStart =
    target._tag === "Range"
      ? target.start
      : target._tag === "Recording" && padded !== undefined
        ? epochMs(padded.start)
        : undefined;
  const windowEnd =
    target._tag === "Range"
      ? target.end
      : target._tag === "Recording" && padded !== undefined
        ? epochMs(padded.end)
        : undefined;
  // Live counts back from now; anything else counts on from its window's start.
  const origin = target._tag === "Live" ? input.now - seekable * 1000 : (windowStart ?? input.now);
  const wallAt = (seconds: number) => origin + seconds * 1000;
  const edge = wallAt(seekable);
  const channelId = target._tag === "Recording" ? recording?.channelId : target.channelId;
  const relative = target._tag === "Range" || (target._tag === "Recording" && !input.running);

  let start: number;
  let end: number;
  if (target._tag === "Live") {
    const row =
      channelId === undefined ? [] : (rowsByChannel(input.programmes).get(channelId) ?? []);
    const onAir = programmeAt(row, edge - 1);
    start = origin;
    end = Math.max(edge, onAir === undefined ? edge : epochMs(onAir.end));
  } else if (relative) {
    start = origin;
    end = seekable > 0 ? edge : (windowEnd ?? origin);
  } else {
    start = origin;
    end = Math.max(windowEnd ?? edge, edge);
  }

  const bands =
    target._tag === "Recording"
      ? recording === undefined
        ? []
        : recordingBands(recording, input.programmes, start, end)
      : channelId === undefined
        ? []
        : bandsIn(input.programmes, channelId, start, end);
  const marks =
    target._tag === "Recording" && recording !== undefined
      ? [epochMs(recording.start), epochMs(recording.end)]
      : [];
  const data: TimelineData = {
    start,
    end,
    ...(seekable > 0 ? { captured: { start: origin, end: edge } } : {}),
    ...(relative ? {} : { live: edge }),
    ...(input.at === undefined ? {} : { playhead: wallAt(Math.min(seekable, input.at)) }),
    bands,
    marks: bandTicks(bands, marks),
  };
  const length = end - start;
  return {
    data,
    layout: layoutTimeline(data),
    relative,
    share: (seconds) => (length > 0 ? (wallAt(seconds) - start) / length : 0),
    seekAt: (fraction) => {
      const time = seekTimeAt(data, fraction);
      return time === undefined
        ? undefined
        : Math.max(0, Math.min(seekable, (time - origin) / 1000));
    },
  };
};

/**
 * The read-out's facts, for the shared wording (`playerReadout`): a finished recording or a
 * range says what is left, when it ends at this speed and what it misses (an incomplete
 * recording); anything with a live edge how far behind it is, where the playhead is and when a
 * faster speed reaches live.
 */
export const readoutOf = (input: {
  readonly finished: boolean;
  readonly progress: PlayerProgress | undefined;
  readonly atLive: boolean;
  readonly speed: number;
  readonly now: number;
  /** The playhead on the wall clock. */
  readonly playhead: number;
  /** The end of the recording window; live TV has none. */
  readonly windowEnd: number | undefined;
  readonly recording: RecordingEntry | undefined;
}): PlayerReadout | undefined => {
  const { progress, speed, now } = input;
  if (progress === undefined) return undefined;
  const behindMs = behindLive(progress) * 1000;
  if (input.finished) {
    const leftMs = behindMs;
    return playerReadout({
      mode: "finished",
      leftMs,
      speed,
      endsAt: playbackEndsAt({ now, leftMs, speed }),
      missingMs:
        input.recording?.state === "incomplete"
          ? recordingGapSummary(input.recording).missingMs
          : undefined,
    });
  }
  return playerReadout({
    mode: "running",
    atLive: input.atLive,
    behindMs,
    position: input.playhead,
    speed,
    liveAt: input.atLive
      ? undefined
      : liveEta({
          now,
          behindMs,
          speed,
          ...(input.windowEnd === undefined ? {} : { windowEnd: input.windowEnd }),
        }),
  });
};

/** A label over or under the bar, its spot a share of the bar. */
export interface BarLabel {
  readonly text: string;
  readonly at: number;
  readonly align: LabelAlign;
  readonly visible: boolean;
}

/** The words around the bar. */
export interface BarLabels {
  /** Your time over the knob. */
  readonly here: BarLabel | undefined;
  /** "LIVE 18:42" at the live edge, while you are behind it. */
  readonly live: BarLabel | undefined;
  readonly start: BarLabel;
  readonly end: BarLabel;
}

/** The type size the domain's label widths are measured in, px (`topLabelWidths`). */
const LABEL_BASE_SIZE = 12;

const label = (text: string, place: PlacedLabel): BarLabel => ({
  text,
  at: place.left / 100,
  align: place.align,
  visible: place.visible,
});

/** Label and band type sizes in dp: the web's 12 px and 11.5 px, TV's at 1080p. */
export const barTypeSizes = (em: number, isTV: boolean) => ({
  label: (isTV ? 0.92 : 0.75) * em,
  band: (isTV ? 0.88 : 0.72) * em,
});

/**
 * The labels around the bar, placed by the shared rules (`placeLabels`): a label too close to
 * another one, or to an edge's dot, hides but keeps its row. `width` is the bar's width and
 * `labelSize` the labels' type size, both dp; the domain measures at 12 px type.
 */
export const barLabels = (
  bar: PlayerBar,
  atLive: boolean,
  width: number,
  labelSize: number,
): BarLabels => {
  const f = formatters();
  const { data, layout } = bar;
  const placed = placeLabels(layout, (width * LABEL_BASE_SIZE) / Math.max(1, labelSize));
  const time = (value: number) =>
    bar.relative ? f.clock(Math.max(0, value - data.start) / 1000) : f.time(new Date(value));
  return {
    here:
      placed.here === undefined || data.playhead === undefined
        ? undefined
        : label(time(data.playhead), placed.here),
    live:
      placed.live === undefined || data.live === undefined || atLive || bar.relative
        ? undefined
        : label(m.timeline_live_label({ clock: f.time(new Date(data.live)) }), placed.live),
    start: label(time(data.start), placed.start),
    end: label(time(data.end), placed.end),
  };
};
