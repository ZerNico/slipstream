import type { RecordingId } from "./ids.ts";
import { isPlayable, type Recording } from "./recording.ts";
import { epochMs, padRange } from "./time.ts";

/*
 * The watch choice (SPEC §7.6), the same on every client. Options carry wall-clock times, so they
 * sit on the timeline ("Resume at 18:11" while recording); a finished recording's position is
 * `at - windowStart` ("Resume from 46:30"), what the server stores as `positionMillis`.
 */

/** One way to start watching, at a wall-clock time (epoch ms) inside the recording window. */
export interface ChoiceOption {
  readonly kind: "resume" | "start" | "live";
  readonly at: number;
}

/** What the choice is about, in wall-clock epoch ms. */
export interface ChoiceInput {
  /** The recording window, extra time included (17:55 to 20:30): the same on every surface. */
  readonly windowStart: number;
  readonly windowEnd: number;
  /** Still recording (the live edge is `now`), or finished. */
  readonly live: boolean;
  readonly now: number;
  /** Where this profile stopped, inside the window; absent: never started (or watched). */
  readonly resumeAt?: number | undefined;
}

/** The options, primary first, or `direct` when there is nothing to ask. */
export interface Choice {
  readonly options: readonly ChoiceOption[];
  /** A finished recording without a position: it plays from the beginning without asking. */
  readonly direct: boolean;
}

/** A resume point this close to the live edge or the end is no point: it counts as none. */
const nothingLeftMs = 30_000;

/**
 * The options for a recording: a running one offers Resume (with a position), Watch from start
 * and Watch live; a finished one with a position offers Resume and Play from the beginning; a
 * finished one without a position plays directly. The first option is primary.
 */
export const watchChoice = (input: ChoiceInput): Choice => {
  const edge = input.live ? Math.min(input.now, input.windowEnd) : input.windowEnd;
  const resume =
    input.resumeAt !== undefined &&
    input.resumeAt > input.windowStart &&
    edge - input.resumeAt > nothingLeftMs
      ? input.resumeAt
      : undefined;
  const start: ChoiceOption = { kind: "start", at: input.windowStart };
  const resumeOption: ChoiceOption[] = resume === undefined ? [] : [{ kind: "resume", at: resume }];
  if (input.live) {
    return { direct: false, options: [...resumeOption, start, { kind: "live", at: edge }] };
  }
  return { direct: resume === undefined, options: [...resumeOption, start] };
};

/** What the choice reads of a recording: its window, its state and this profile's position. */
export type ChoiceRecording = Pick<Recording, "id" | "state" | "start" | "end" | "padding"> & {
  readonly watched: boolean;
  /** This profile's resume position, ms from the padded start. */
  readonly positionMillis: number;
};

/** A recording's choice with the window it spans. */
export interface RecordingChoice extends Choice, ChoiceInput {
  readonly recordingId: RecordingId;
}

/**
 * The choice for a recording the pick landed on (`playTargetFor`), or `undefined` when it has
 * nothing to play (scheduled, failed, cancelled). A watched recording has no resume point.
 */
export const watchChoiceFor = (
  recording: ChoiceRecording,
  now: number,
): RecordingChoice | undefined => {
  if (!isPlayable(recording)) return undefined;
  const window = padRange(recording, recording.padding);
  const windowStart = epochMs(window.start);
  const position = recording.watched ? 0 : recording.positionMillis;
  const input: ChoiceInput = {
    windowStart,
    windowEnd: epochMs(window.end),
    live: recording.state === "recording",
    now,
    resumeAt: position > 0 ? windowStart + position : undefined,
  };
  return { recordingId: recording.id, ...input, ...watchChoice(input) };
};
