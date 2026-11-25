import type { PlaybackProgress } from "@slipstream/api";
import {
  progressSaveIntervalMs,
  recordingProgress,
  type RecordingId,
  type RecordingState,
} from "@slipstream/domain";
import type { PlayerProgress } from "./seek.ts";

/**
 * What the player stores for a recording at `at`. A recording playlist starts at the padded
 * start, which is where the server counts `positionMillis` from, so the player's position is
 * the offset as it is; position and watched flag come from the domain (`recordingProgress`),
 * as on the web.
 */
export const progressAt = (
  recordingId: RecordingId,
  at: PlayerProgress,
  state: RecordingState | undefined,
): PlaybackProgress => ({
  target: { _tag: "Recording", recordingId },
  ...recordingProgress({
    positionMs: at.currentTime * 1000,
    durationMs: at.seekableDuration * 1000,
    state,
  }),
});

/** Why a save happens: the timer while playing, a pause, or the player closing. */
export type SaveReason = "tick" | "pause" | "close";

/** Decides when the player stores its position; the player reports, this calls `save`. */
export interface ProgressSaver {
  /** A progress report from the player (about every second), with the time it arrived. */
  readonly report: (at: PlayerProgress, now: number) => void;
  /** Playback was paused: store where it stopped. */
  readonly pause: () => void;
  /** The player closes: store the last position; nothing is stored after this. */
  readonly close: () => void;
}

/**
 * Stores the position every `everyMs` while reports arrive, on pause and on close. Nothing is
 * stored before the first report, so a player closed before it loaded never overwrites the
 * resume point with 0. The timer and a pause skip a position already stored (a paused player
 * keeps reporting the same one); closing always stores, so the screens behind refresh.
 */
export const makeProgressSaver = (
  save: (at: PlayerProgress, reason: SaveReason) => void,
  everyMs: number = progressSaveIntervalMs,
): ProgressSaver => {
  let latest: PlayerProgress | undefined;
  let lastSaveAt: number | undefined;
  let savedTime: number | undefined;
  let closed = false;
  const store = (reason: SaveReason) => {
    if (closed || latest === undefined) return;
    if (reason !== "close" && latest.currentTime === savedTime) return;
    savedTime = latest.currentTime;
    save(latest, reason);
  };
  return {
    report: (at, now) => {
      if (closed) return;
      latest = at;
      if (lastSaveAt === undefined) {
        lastSaveAt = now;
        return;
      }
      if (now - lastSaveAt < everyMs) return;
      lastSaveAt = now;
      store("tick");
    },
    pause: () => store("pause"),
    close: () => {
      store("close");
      closed = true;
    },
  };
};
