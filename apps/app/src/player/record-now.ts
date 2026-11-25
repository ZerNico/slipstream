import type { RecordingEntry } from "@slipstream/api";
import { type GuideEntry, recordNowNote, recordNowState } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import type { PlayTarget } from "./playback.ts";
import { behindLive, type PlayerProgress } from "./seek.ts";

/*
 * Record in the player (phone and TV), the web's rule: one press records the programme at the
 * playhead with what the capture already holds; while it records, Extend and Stop. The domain
 * decides (`recordNowState`, `recordNowNote`); this reads the app's player into it.
 */

/** How far back the player's guide reaches: as far as the pause buffer does. */
const GUIDE_BEHIND_MS = 4 * 3_600_000;
/** How far ahead the player's guide reaches. */
const GUIDE_AHEAD_MS = 8 * 3_600_000;
/** The guide window moves on in steps this long, so its query key holds still between them. */
const GUIDE_STEP_MS = 300_000;

/**
 * The stretch of the channel's guide the player's Record reads at `now`: back as far as the
 * pause buffer reaches and some hours ahead, moving on with the clock in five-minute steps.
 */
export const guideWindowAt = (now: number): { readonly from: number; readonly to: number } => {
  const step = Math.floor(now / GUIDE_STEP_MS) * GUIDE_STEP_MS;
  return { from: step - GUIDE_BEHIND_MS, to: step + GUIDE_AHEAD_MS };
};

/** Where the playhead is: wall clock, and the first second the pause buffer holds. */
export interface PlayheadAt {
  readonly atMs: number;
  readonly capturedFromMs: number | undefined;
}

/**
 * The playhead on the wall clock. Live counts back from now (react-native-video reports the
 * position from the oldest listed segment, and the edge is now); a recording counts on from its
 * padded start (`windowStart`).
 */
export const playheadAt = (
  target: PlayTarget,
  progress: PlayerProgress | undefined,
  now: number,
  windowStart: number | undefined,
): PlayheadAt => {
  if (progress === undefined) return { atMs: now, capturedFromMs: undefined };
  if (target._tag === "Live") {
    const span = Number.isFinite(progress.seekableDuration) ? progress.seekableDuration : 0;
    return { atMs: now - behindLive(progress) * 1000, capturedFromMs: now - span * 1000 };
  }
  if (windowStart === undefined) return { atMs: now, capturedFromMs: undefined };
  return { atMs: windowStart + progress.currentTime * 1000, capturedFromMs: windowStart };
};

/** What the player's Record control is. */
export type PlayerRecord =
  | { readonly kind: "record"; readonly programme: GuideEntry }
  | {
      readonly kind: "recording";
      readonly recording: RecordingEntry;
      /** Its guide entry, for the full record options, when the guide has it. */
      readonly programme: GuideEntry | undefined;
    };

/**
 * The Record control for what the player plays, or undefined (none shown): a profile that may
 * not record, a captured range (it has ended), a finished recording, or a live channel with no
 * programme on air at the playhead. A recording being played is the control's while it runs.
 */
export const playerRecord = (input: {
  readonly target: PlayTarget;
  readonly mayRecord: boolean;
  readonly playhead: PlayheadAt;
  readonly now: number;
  readonly programmes: readonly GuideEntry[];
  readonly recordings: readonly RecordingEntry[];
  /** The recording the player plays, when it plays one. */
  readonly playing: RecordingEntry | undefined;
}): PlayerRecord | undefined => {
  if (!input.mayRecord) return undefined;
  const { target } = input;
  if (target._tag === "Range") return undefined;
  if (target._tag === "Recording") {
    const { playing } = input;
    if (playing?.state !== "recording") return undefined;
    const programme = input.programmes.find((entry) => entry.id === playing.programmeId);
    return { kind: "recording", recording: playing, programme };
  }
  const state = recordNowState({
    programmes: input.programmes,
    channelId: target.channelId,
    atMs: input.playhead.atMs,
    nowMs: input.now,
    recordings: input.recordings,
  });
  switch (state._tag) {
    case "Unavailable":
      return undefined;
    case "Record":
      return { kind: "record", programme: state.programme };
    case "Recording":
      return { kind: "recording", recording: state.recording, programme: state.programme };
  }
};

/** Whether the top bar's red chip shows: the control records, and it is running. */
export const recordingShown = (record: PlayerRecord | undefined): boolean =>
  record?.kind === "recording" && record.recording.state === "recording";

/**
 * The toast after Record: "Recording Tatort · From 20:13 · 14 min before you pressed", where
 * the recording starts as far as the capture holds it.
 */
export const recordedText = (
  title: string,
  recording: Pick<RecordingEntry, "start" | "padding">,
  playhead: PlayheadAt,
  pressedAtMs: number,
): string => {
  const note = recordNowNote({ recording, capturedFromMs: playhead.capturedFromMs, pressedAtMs });
  const from = new Date(note.fromMs);
  return [
    m.guide_recording_started({ title }),
    note.earlierMinutes > 0
      ? m.record_now_from_earlier({ from, minutes: note.earlierMinutes })
      : m.record_now_from({ from }),
  ].join(" · ");
};
