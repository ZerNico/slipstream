/**
 * What Home shows, as pure functions over the API's data (SPEC §8.1): which of the five hero
 * states applies, the initial switcher tab, and the rows under the hero. No React and no clock
 * reads here; the screen passes `now`, so every rule is tested without a browser.
 */
import type { NowNext, RecordingEntry, ScheduleConflict } from "@slipstream/api";
import {
  type Channel,
  epochMs,
  isNew,
  isPlayable,
  MINUTE,
  type PlaybackState,
  type Programme,
  type Rule,
  onAirNow,
  type UserId,
} from "@slipstream/domain";
import { recordedSpan, resumeMillis } from "~/modules/library/library.ts";

/** A recording that starts within this window makes the hero "Starts soon". */
export const soonWindowMs = 60 * MINUTE;

/** Continue watching in the hero only looks this far back (SPEC §8.1 Idle). */
export const continueWindowMs = 7 * 24 * 60 * MINUTE;

/** How many scheduled recordings the Home row shows. */
export const scheduledRowLimit = 8;

/** How many new recordings the Home row shows. */
export const newRowLimit = 12;

/** Everything Home's choices depend on. */
export interface HomeData {
  readonly now: number;
  readonly me: UserId;
  /** The library as this profile sees it, with its own positions (`watched`, `positionMillis`). */
  readonly recordings: readonly RecordingEntry[];
  readonly rules: readonly Rule[];
  /** How many sources exist; none means the household is still setting up. */
  readonly sourceCount: number;
  readonly channels: readonly Channel[];
  readonly nowNext: readonly NowNext[];
  /** This profile's unfinished playback states, for the order of Continue watching. */
  readonly progress: readonly PlaybackState[];
}

/** The hero's state, first match wins (SPEC §8.1). */
export type Hero =
  | { readonly kind: "onboarding"; readonly hasSource: boolean }
  | { readonly kind: "recording"; readonly items: readonly RecordingEntry[] }
  | {
      readonly kind: "soon";
      readonly entry: RecordingEntry;
      /** What the channel airs now, for the timeline's first band. */
      readonly onAir: Programme | undefined;
    }
  | { readonly kind: "continue"; readonly entry: RecordingEntry }
  | { readonly kind: "new"; readonly entry: RecordingEntry }
  | { readonly kind: "live"; readonly programme: Programme }
  | { readonly kind: "idle" };

/** Every hero state, in selection order. */
export type HeroKind = Hero["kind"];

const byStart = (a: RecordingEntry, b: RecordingEntry) => epochMs(a.start) - epochMs(b.start);
const byEndDesc = (a: RecordingEntry, b: RecordingEntry) => epochMs(b.end) - epochMs(a.end);

/** Running recordings, earliest start first: the switcher's tab order. */
export const runningRecordings = (data: Pick<HomeData, "recordings">): readonly RecordingEntry[] =>
  data.recordings.filter((entry) => entry.state === "recording").toSorted(byStart);

/** Whether this recording belongs to the profile: it owns it, or its rule recorded it. */
export const isOwnRecording = (
  entry: RecordingEntry,
  me: UserId,
  rules: readonly Rule[],
): boolean =>
  entry.ownerIds.includes(me) ||
  rules.some((rule) => rule.id === entry.ruleId && rule.ownerId === me);

/**
 * The switcher's first tab (SPEC §8.1): the recording this profile has a resume position in,
 * then the one it owns or its rule recorded, then the earliest start (the first tab).
 */
export const initialTab = (
  items: readonly RecordingEntry[],
  me: UserId,
  rules: readonly Rule[],
): number => {
  const resumable = items.findIndex((entry) => resumeMillis(entry) !== undefined);
  if (resumable >= 0) return resumable;
  return Math.max(
    0,
    items.findIndex((entry) => isOwnRecording(entry, me, rules)),
  );
};

/** Nothing to show yet: no source, or no enabled rule and nothing ever recorded. */
const isOnboarding = (data: HomeData): boolean =>
  data.sourceCount === 0 ||
  (!data.rules.some((rule) => rule.enabled) &&
    !data.recordings.some((entry) => entry.state !== "cancelled"));

/** The scheduled recording whose recorded window starts next within the hour, if any. */
export const startingSoon = (data: Pick<HomeData, "recordings" | "now">) =>
  data.recordings
    .filter((entry) => {
      if (entry.state !== "scheduled") return false;
      const start = recordedSpan(entry).start;
      return start > data.now && start - data.now <= soonWindowMs;
    })
    .toSorted(byStart)[0];

/** Unfinished recordings with a resume position, most recently watched first. */
export const continueList = (
  data: Pick<HomeData, "recordings" | "progress">,
): readonly RecordingEntry[] => {
  const updated = new Map<string, number>();
  for (const state of data.progress) {
    if (state.target._tag === "Recording") {
      updated.set(state.target.recordingId, epochMs(state.updatedAt));
    }
  }
  return data.recordings
    .filter(
      (entry) =>
        entry.state !== "recording" && isPlayable(entry) && resumeMillis(entry) !== undefined,
    )
    .toSorted((a, b) => {
      const byUpdate = (updated.get(b.id) ?? 0) - (updated.get(a.id) ?? 0);
      return byUpdate === 0 ? byEndDesc(a, b) : byUpdate;
    });
};

/** When this profile last watched a recording, epoch ms, if the server told us. */
const lastWatched = (data: Pick<HomeData, "progress">, entry: RecordingEntry) => {
  const state = data.progress.find(
    (candidate) =>
      candidate.target._tag === "Recording" && candidate.target.recordingId === entry.id,
  );
  return state === undefined ? undefined : epochMs(state.updatedAt);
};

/** Finished recordings this profile has not started, newest first. */
export const newList = (data: Pick<HomeData, "recordings">): readonly RecordingEntry[] =>
  data.recordings.filter(isNew).toSorted(byEndDesc);

/** What airs now on each visible channel, in channel order. */
const airingNow = (data: Pick<HomeData, "channels" | "nowNext" | "now">) =>
  onAirNow(data.channels, data.nowNext, data.now);

/** The hero's state for this profile right now (SPEC §8.1, first match wins). */
export const selectHero = (data: HomeData): Hero => {
  if (isOnboarding(data)) return { kind: "onboarding", hasSource: data.sourceCount > 0 };
  const running = runningRecordings(data);
  if (running.length > 0) return { kind: "recording", items: running };
  const soon = startingSoon(data);
  if (soon !== undefined) {
    const onAir = data.nowNext.find((entry) => entry.channelId === soon.channelId)?.now;
    return { kind: "soon", entry: soon, onAir };
  }
  const recent = continueList(data).find((entry) => {
    const at = lastWatched(data, entry);
    return at === undefined || data.now - at < continueWindowMs;
  });
  if (recent !== undefined) return { kind: "continue", entry: recent };
  const [fresh] = newList(data);
  if (fresh !== undefined) return { kind: "new", entry: fresh };
  const airing = airingNow(data);
  const favourite = airing.find((item) => item.channel.favourite) ?? airing[0];
  if (favourite !== undefined) return { kind: "live", programme: favourite.programme };
  return { kind: "idle" };
};

/**
 * Every recording the hero can show in this render (all switcher tabs, not only the selected
 * one): the mini player stays away from them and the row under the hero leaves them out.
 */
export const heroRecordingIds = (hero: Hero): readonly string[] => {
  switch (hero.kind) {
    case "recording":
      return hero.items.map((entry) => entry.id);
    case "soon":
    case "continue":
    case "new":
      return [hero.entry.id];
    case "onboarding":
    case "live":
    case "idle":
      return [];
  }
};

/** One On now card: the channel, what airs, and the recording of it that is running, if any. */
export interface OnNowItem {
  readonly channel: Channel;
  readonly programme: Programme;
  readonly recording: RecordingEntry | undefined;
}

/** The On now row: every visible channel's current programme, with its running recording. */
export const onNowRow = (data: HomeData): readonly OnNowItem[] => {
  const running = runningRecordings(data);
  return airingNow(data).map(({ channel, programme }) => ({
    channel,
    programme,
    recording: running.find(
      (entry) =>
        entry.channelId === channel.id &&
        (entry.programmeId === undefined || entry.programmeId === programme.id),
    ),
  }));
};

/** The Continue watching row, without what the hero shows right above it. */
export const continueRow = (data: HomeData, heroIds: readonly string[]) =>
  continueList(data).filter((entry) => !heroIds.includes(entry.id));

/** The New in your library row, without the hero's item. */
export const newRow = (data: HomeData, heroIds: readonly string[]) =>
  newList(data)
    .filter((entry) => !heroIds.includes(entry.id))
    .slice(0, newRowLimit);

/** One Scheduled recordings card, with its Conflict badge. */
export interface ScheduledItem {
  readonly entry: RecordingEntry;
  readonly conflict: boolean;
}

/**
 * The Scheduled recordings row: the next scheduled recordings, each flagged when it is part of
 * an overlap. Every item of an overlap carries the badge (SPEC §8.1).
 */
export const scheduledRow = (
  data: Pick<HomeData, "recordings" | "now">,
  conflicts: readonly ScheduleConflict[],
): readonly ScheduledItem[] => {
  const clashing = new Set(conflicts.flatMap((conflict) => conflict.recordingIds));
  return data.recordings
    .filter((entry) => entry.state === "scheduled" && epochMs(entry.end) > data.now)
    .toSorted(byStart)
    .slice(0, scheduledRowLimit)
    .map((entry) => ({ entry, conflict: clashing.has(entry.id) }));
};
