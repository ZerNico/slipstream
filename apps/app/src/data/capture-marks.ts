import type { RecordingEntry } from "@slipstream/api";
import {
  type Collection,
  epochMs,
  groupKeyOf,
  isPlayable,
  libraryGroups,
  padRange,
  type PathLabels,
} from "@slipstream/domain";
import type { TimelineMarks } from "../ui/CaptureTimeline.tsx";

/*
 * What a recording's page and Home's hero show on phone and TV alike: the capture timeline's
 * marks, how far the viewer got, and the place the recording belongs to.
 */

/** The capture marks for a window (epoch ms) and the programme inside it. */
export const windowMarks = (
  window: { readonly from: number; readonly until: number },
  programme: { readonly start: number; readonly end: number },
  now: number,
): { readonly marks: TimelineMarks; readonly share: (time: number) => number } => {
  const span = Math.max(1, window.until - window.from);
  const share = (time: number) => (time - window.from) / span;
  return {
    share,
    marks: { captured: share(now), ticks: [share(programme.start), share(programme.end)] },
  };
};

/**
 * A recording's capture marks over its window, extra time included, and how far this profile
 * watched (a share of the window; undefined when watched or not started).
 */
export const captureMarks = (
  entry: RecordingEntry,
  now: number,
): { readonly marks: TimelineMarks; readonly watched: number | undefined } => {
  const window = padRange(entry, entry.padding);
  const from = epochMs(window.start);
  const { marks, share } = windowMarks(
    { from, until: epochMs(window.end) },
    { start: epochMs(entry.start), end: epochMs(entry.end) },
    now,
  );
  const watched =
    entry.watched || entry.positionMillis <= 0 ? undefined : share(from + entry.positionMillis);
  return { marks: watched === undefined ? marks : { ...marks, played: watched }, watched };
};

/**
 * The place a recording's page links to: its show or collection, when that holds more than this
 * one recording.
 */
export const placeOf = (
  entry: RecordingEntry,
  all: readonly RecordingEntry[],
  collections: readonly Collection[],
  labels: PathLabels,
): { readonly key: string; readonly name: string } | undefined => {
  const key = groupKeyOf(entry, labels);
  const group = libraryGroups(
    all.filter((candidate) => isPlayable(candidate) && groupKeyOf(candidate, labels) === key),
    collections,
    labels,
  )[0];
  return group !== undefined && group.entries.length > 1 ? { key, name: group.name } : undefined;
};
