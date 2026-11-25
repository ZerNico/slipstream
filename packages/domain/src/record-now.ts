import { type Airing, type AiringRecording, recordingsOfAiring } from "./airing.ts";
import type { ChannelId } from "./ids.ts";
import { isActive } from "./recording.ts";
import { epochMs, type Instant, MINUTE, type Padding } from "./time.ts";

/*
 * Record in the player, on every client: one press records the programme at the playhead (live
 * or in pause & rewind). The recording keeps what the channel's capture already holds of it,
 * back to the programme's start with its extra time, not only from the press.
 */

/** What the player's Record control is for the programme at the playhead. */
export type RecordNowState<P, A> =
  /** Nothing to record: no guide entry there, or the programme has ended. */
  | { readonly _tag: "Unavailable" }
  /** One press records `programme`. */
  | { readonly _tag: "Record"; readonly programme: P }
  /** `recording` (scheduled or running) records it already: Extend and Stop instead. */
  | { readonly _tag: "Recording"; readonly programme: P; readonly recording: A };

/** What working out the Record control needs. */
export interface RecordNowInput<P extends Airing, A extends AiringRecording> {
  /** Guide entries around the playhead; other channels' are ignored. */
  readonly programmes: readonly P[];
  readonly channelId: ChannelId;
  /** Where the playhead is, wall clock (epoch ms). */
  readonly atMs: number;
  readonly nowMs: number;
  /** The recordings the viewer can see. */
  readonly recordings: readonly A[];
}

/**
 * The Record control for the programme on air at the playhead: recorded already when a
 * scheduled or running recording of that airing exists (`recordingsOfAiring`), recordable while
 * it has not ended, else unavailable (a finished programme in the pause buffer is gone for
 * recording; the server refuses it as `programmeEnded`).
 */
export const recordNowState = <P extends Airing, A extends AiringRecording>(
  input: RecordNowInput<P, A>,
): RecordNowState<P, A> => {
  const programme = input.programmes.find(
    (candidate) =>
      candidate.channelId === input.channelId &&
      epochMs(candidate.start) <= input.atMs &&
      input.atMs < epochMs(candidate.end),
  );
  if (programme === undefined) return { _tag: "Unavailable" };
  const recording = recordingsOfAiring(programme, input.recordings).find(isActive);
  if (recording !== undefined) return { _tag: "Recording", programme, recording };
  if (epochMs(programme.end) <= input.nowMs) return { _tag: "Unavailable" };
  return { _tag: "Record", programme };
};

/** What the toast after Record says: where the recording starts, and how much came before the press. */
export interface RecordNowNote {
  /** Where the recording starts, wall clock (epoch ms). */
  readonly fromMs: number;
  /** Whole minutes of it from before the press; 0 when under a minute. */
  readonly earlierMinutes: number;
}

/**
 * Where a recording made by Record starts: its programme start less its extra time, but never
 * before what the channel's capture holds (`capturedFromMs`, the start of the player's pause
 * buffer; unknown means the whole range is there), and never after the press.
 */
export const recordNowNote = (input: {
  readonly recording: { readonly start: Instant; readonly padding: Padding };
  readonly capturedFromMs: number | undefined;
  readonly pressedAtMs: number;
}): RecordNowNote => {
  const paddedStart =
    epochMs(input.recording.start) - input.recording.padding.beforeMinutes * MINUTE;
  const fromMs = Math.min(
    input.pressedAtMs,
    Math.max(paddedStart, input.capturedFromMs ?? Number.NEGATIVE_INFINITY),
  );
  return { fromMs, earlierMinutes: Math.floor((input.pressedAtMs - fromMs) / MINUTE) };
};
