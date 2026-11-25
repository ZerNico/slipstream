import {
  type Channel,
  epochMs,
  isRecorded,
  padRange,
  type PlaybackState,
  type Recording,
  type RecordingId,
} from "@slipstream/domain";

/** Why the hero shows this recording: it is running, it is next, or it is the latest. */
export type HeroKind = "recording" | "next" | "latest";

/** What the home screen leads with (design doc "TV · Home"). Times are epoch ms. */
export interface Hero {
  readonly kind: HeroKind;
  readonly recordingId: RecordingId;
  readonly channelId: Recording["channelId"];
  readonly channelName: string;
  readonly title: string;
  readonly subtitle: string | undefined;
  readonly start: number;
  readonly end: number;
  /** Earliest captured time: the start minus "start early". */
  readonly capturedFrom: number;
  /** When recording stops: the end plus "keep after". */
  readonly recordingUntil: number;
}

/** A row in "Continue watching". */
export interface ContinueItem {
  readonly recordingId: RecordingId;
  readonly channelId: Recording["channelId"];
  readonly channelName: string;
  readonly title: string;
  readonly start: number;
  readonly secondsLeft: number;
  /** Watched share, 0 to 1. */
  readonly progress: number;
}

/** Everything the home screens show. */
export interface HomeModel {
  readonly hero: Hero | undefined;
  readonly continueWatching: readonly ContinueItem[];
}

/** The recorded window in epoch ms: the programme widened by its extra time (`padRange`). */
const paddedRange = (recording: Recording) => {
  const padded = padRange(recording, recording.padding);
  return { from: epochMs(padded.start), until: epochMs(padded.end) };
};

const heroOf = (kind: HeroKind, recording: Recording, names: ReadonlyMap<string, string>): Hero => {
  const { from, until } = paddedRange(recording);
  return {
    kind,
    recordingId: recording.id,
    channelId: recording.channelId,
    channelName: names.get(recording.channelId) ?? "",
    title: recording.title,
    subtitle: recording.subtitle,
    start: epochMs(recording.start),
    end: epochMs(recording.end),
    capturedFrom: from,
    recordingUntil: until,
  };
};

/**
 * The hero: the running recording that started first, otherwise the next scheduled one,
 * otherwise the latest finished one; nothing when the library is empty.
 */
export const pickHero = (
  recordings: readonly Recording[],
  names: ReadonlyMap<string, string>,
  now: number,
): Hero | undefined => {
  const byStart = recordings.toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
  const running = byStart.find((recording) => recording.state === "recording");
  if (running !== undefined) return heroOf("recording", running, names);
  const next = byStart.find(
    (recording) => recording.state === "scheduled" && paddedRange(recording).until > now,
  );
  if (next !== undefined) return heroOf("next", next, names);
  const latest = byStart.findLast(isRecorded);
  return latest === undefined ? undefined : heroOf("latest", latest, names);
};

/**
 * "Continue watching": recordings with a saved position that are not watched yet, most
 * recently watched first, with how much is left of the recorded (padded) length.
 */
export const continueItems = (
  states: readonly PlaybackState[],
  recordings: readonly Recording[],
  names: ReadonlyMap<string, string>,
): readonly ContinueItem[] => {
  const byId = new Map(recordings.map((recording) => [recording.id as string, recording]));
  return states
    .filter((state) => !state.watched && state.target._tag === "Recording")
    .toSorted((a, b) => epochMs(b.updatedAt) - epochMs(a.updatedAt))
    .flatMap((state) => {
      const recording =
        state.target._tag === "Recording" ? byId.get(state.target.recordingId) : undefined;
      if (recording === undefined) return [];
      const { from, until } = paddedRange(recording);
      const length = Math.max(1, until - from);
      const position = Math.min(state.positionMillis, length);
      return [
        {
          recordingId: recording.id,
          channelId: recording.channelId,
          channelName: names.get(recording.channelId) ?? "",
          title: recording.title,
          start: epochMs(recording.start),
          secondsLeft: Math.round((length - position) / 1000),
          progress: position / length,
        },
      ];
    });
};

/** Channel id to name, for labels. */
export const channelNames = (channels: readonly Channel[]): ReadonlyMap<string, string> =>
  new Map(channels.map((channel) => [channel.id as string, channel.name]));

/** The whole home model. */
export const homeModel = (
  recordings: readonly Recording[],
  channels: readonly Channel[],
  states: readonly PlaybackState[],
  now: number,
): HomeModel => {
  const names = channelNames(channels);
  return {
    hero: pickHero(recordings, names, now),
    continueWatching: continueItems(states, recordings, names),
  };
};
