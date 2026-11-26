import { Schema } from "effect";
import { ChannelId, RecordingId } from "./ids.ts";
import { isActive, isRecorded, type Recording, type RecordingState } from "./recording.ts";
import { type Airing, type AiringRecording, recordingsOfAiring } from "./airing.ts";
import { epochMs, MINUTE, TimeRange } from "./time.ts";

/*
 * Playback speed and progress (SPEC §7.1), shared by the web player and the TV app: a plain
 * playback rate, no catch-up mode. Above 1× while behind live, the read-out adds when you will
 * reach live; at live the player drops back to 1×.
 */

/** Fit shows the whole picture; Fill crops it to cover the screen, with no black bars. */
export type FitMode = "fit" | "fill";

/** A fresh device fills the screen, as a TV does. */
export const defaultFit: FitMode = "fill";

/** How far two fingers must spread or close (as a share of where they started) to switch. */
const PINCH_SWITCH = 0.12;

/** Pinching out fills the screen and pinching in fits the whole picture; a small pinch keeps it. */
export const fitAfterPinch = (current: FitMode, scale: number): FitMode =>
  scale > 1 + PINCH_SWITCH ? "fill" : scale < 1 - PINCH_SWITCH ? "fit" : current;

/** Holding a finger on the picture plays this fast until it lets go. */
export const holdSpeed = 2;

/** The speeds the menu offers, slowest first. */
export const playbackSpeeds: readonly number[] = [0.75, 1, 1.25, 1.5, 2];

/** The next speed up (`1`) or down (`-1`) from `current`, held at the ends of the list. */
export const stepSpeed = (current: number, direction: 1 | -1): number => {
  const index = playbackSpeeds.indexOf(current);
  // A rate set elsewhere (not in the list) steps from the nearest listed one.
  const from =
    index !== -1
      ? index
      : playbackSpeeds.reduce(
          (best, speed, at) =>
            Math.abs(speed - current) < Math.abs((playbackSpeeds[best] ?? 1) - current) ? at : best,
          0,
        );
  const next = Math.min(playbackSpeeds.length - 1, Math.max(0, from + direction));
  return playbackSpeeds[next] ?? 1;
};

/**
 * When playing at `speed` reaches live: now plus the gap divided by how much faster than real
 * time it plays. Only while that moment falls inside the recording window (decision r2 #7):
 * after the window ends there is no live to reach. Undefined at 1× or slower, at live, or
 * after the window.
 */
export const liveEta = (input: {
  readonly now: number;
  readonly behindMs: number;
  readonly speed: number;
  /** The end of the recording window, epoch ms; live TV without one never runs out. */
  readonly windowEnd?: number;
}): number | undefined => {
  if (input.speed <= 1 || input.behindMs <= 0) return undefined;
  const eta = input.now + input.behindMs / (input.speed - 1);
  return input.windowEnd !== undefined && eta > input.windowEnd ? undefined : eta;
};

/**
 * When a finished recording ends if it plays on at `speed` from now, epoch ms: what is left
 * divided by the speed ("ends 17:26" under the read-out).
 */
export const playbackEndsAt = (input: {
  readonly now: number;
  readonly leftMs: number;
  readonly speed: number;
}): number => input.now + Math.max(0, input.leftMs) / Math.max(0.25, input.speed);

/** How close to its end a finished recording counts as watched: the last minute. */
export const watchedThreshold = MINUTE;

/**
 * Whether stopping here marks a recording watched: it has finished recording and less than
 * `watchedThreshold` is left. A recording still running is never watched, whatever is left.
 */
export const isWatched = (input: {
  readonly finished: boolean;
  readonly leftMs: number;
}): boolean => input.finished && input.leftMs < watchedThreshold;

/** How often a player stores the resume position while a recording plays: web and TV alike. */
export const progressSaveIntervalMs = 15_000;

/**
 * The resume position and watched flag a player stores for a recording. `positionMs` is the
 * offset from the recording's padded start (where the server counts `positionMillis` from) and
 * `durationMs` the playable length; either may be unknown (`NaN`) while the player loads. A
 * recording of unknown state, or still active (`isActive`), is never watched; failed and
 * stopped-early ones have stopped recording, so their last minute marks them watched too.
 */
export const recordingProgress = (input: {
  readonly positionMs: number;
  readonly durationMs: number;
  readonly state: RecordingState | undefined;
}): { readonly positionMillis: number; readonly watched: boolean } => {
  const positionMillis = Number.isFinite(input.positionMs)
    ? Math.max(0, Math.round(input.positionMs))
    : 0;
  const leftMs = Number.isFinite(input.durationMs)
    ? Math.max(0, input.durationMs - positionMillis)
    : Number.POSITIVE_INFINITY;
  const finished = input.state !== undefined && !isActive({ state: input.state });
  return { positionMillis, watched: isWatched({ finished, leftMs }) };
};

/** What to play: live with a DVR window, a recording, or any captured range (start over). */
export const PlaybackSource = Schema.TaggedUnion({
  Live: { channelId: ChannelId },
  Recording: { recordingId: RecordingId },
  Range: { channelId: ChannelId, range: TimeRange },
}).annotate({ identifier: "PlaybackSource" });
export type PlaybackSource = typeof PlaybackSource.Type;

/**
 * What to play (`PlaybackSource`) plus where a recording starts: at the live edge of a running
 * one, or at the viewer's resume point of a finished one.
 */
export type PlayTarget =
  | Exclude<PlaybackSource, { readonly _tag: "Recording" }>
  | (Extract<PlaybackSource, { readonly _tag: "Recording" }> & {
      readonly from: "live" | "resume";
    });

/** What resolving a play target needs. */
export interface PlayTargetInput<A extends AiringRecording & Pick<Recording, "id">> {
  /** The channel to play, or the programme's channel. */
  readonly channelId: ChannelId;
  /** The programme picked; absent when the channel itself was picked. */
  readonly programme?: Airing | undefined;
  /**
   * Every recording the viewer may see, in any order. `playTargetFor` picks the ones that count
   * itself, so no caller decides that on its own.
   */
  readonly recordings: readonly A[];
  /** Epoch ms. */
  readonly now: number;
}

/**
 * Resolves a pick in the guide, Home or the TV to what plays, the same on every client.
 *
 * - A channel pick: a recording running on that channel, from its live edge (so pausing and
 *   rewinding reach back to where it started), else the channel live. A finished recording of an
 *   earlier programme is no reason to leave live.
 * - A programme pick: of the airing's recordings (`recordingsOfAiring`), a running one from its
 *   live edge, else a completed or incomplete one from the resume point, else live while the
 *   programme airs, else its captured range once it has ended (start over; the server answers
 *   `RangeNotCaptured` when the buffer no longer holds it). A programme that has not started yet
 *   has nothing to play: `undefined`.
 */
export const playTargetFor = <A extends AiringRecording & Pick<Recording, "id">>(
  input: PlayTargetInput<A>,
): PlayTarget | undefined => {
  const { programme } = input;
  if (programme === undefined) {
    const running = input.recordings.find(
      (recording) => recording.channelId === input.channelId && recording.state === "recording",
    );
    return running === undefined
      ? { _tag: "Live", channelId: input.channelId }
      : { _tag: "Recording", recordingId: running.id, from: "live" };
  }
  const recordings = recordingsOfAiring(programme, input.recordings);
  const running = recordings.find((recording) => recording.state === "recording");
  if (running !== undefined) return { _tag: "Recording", recordingId: running.id, from: "live" };
  const done = recordings.find(isRecorded);
  if (done !== undefined) return { _tag: "Recording", recordingId: done.id, from: "resume" };
  if (input.now < epochMs(programme.start)) return undefined;
  if (input.now < epochMs(programme.end)) return { _tag: "Live", channelId: input.channelId };
  return {
    _tag: "Range",
    channelId: input.channelId,
    range: { start: programme.start, end: programme.end },
  };
};

/** Five minutes: how long before a playback session expires a player renews it. */
export const renewalLeadMillis = 5 * MINUTE;

/** The shortest wait before a renewal, so a session already near or past expiry never spins. */
export const renewalFloorMillis = 5_000;

/**
 * How long a player waits before renewing a playback session that expires at `expiresAt`
 * (epoch ms): until five minutes before it expires, never less than `renewalFloorMillis`. A
 * session already within those five minutes, or past them, renews after the floor.
 */
export const renewalDelayMillis = (expiresAt: number, now: number): number => {
  const delay = expiresAt - renewalLeadMillis - now;
  return Number.isFinite(delay) ? Math.max(renewalFloorMillis, delay) : renewalFloorMillis;
};
