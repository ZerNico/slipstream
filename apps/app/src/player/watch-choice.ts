import {
  type ChoiceOption,
  isPlayable,
  type RecordingChoice,
  type RecordingId,
  watchChoiceFor,
} from "@slipstream/domain";
import type { RecordingEntry } from "@slipstream/api";
import { type PickedProgramme, programmePlayTarget, type PlayTarget } from "./playback.ts";

/*
 * The watch choice itself (`watchChoiceFor`) is the domain's, the same as the web's; the app adds
 * what OK on something to watch does, the same on every surface (guide, search, record sheet),
 * and where the player opens for a picked option.
 */

/** What the player opens for a picked option. */
export const choiceTarget = (recordingId: RecordingId, option: ChoiceOption): PlayTarget => ({
  _tag: "Recording",
  recordingId,
  from: option.kind,
});

/**
 * What OK does: nothing to play yet opens the caller's sheet (the record sheet, a recording's
 * page); a recording this profile already started asks Resume or From start first, as on the
 * web; anything else plays.
 */
export type WatchPick =
  | { readonly _tag: "Sheet" }
  | { readonly _tag: "Choose"; readonly choice: RecordingChoice }
  | { readonly _tag: "Play"; readonly target: PlayTarget };

/** Plays `target`, or asks first when it is a recording this profile started; see {@link WatchPick}. */
export const pickTarget = (
  target: PlayTarget | undefined,
  entries: readonly RecordingEntry[],
  now: number,
): WatchPick => {
  if (target === undefined) return { _tag: "Sheet" };
  if (target._tag === "Recording") {
    const entry = entries.find((candidate) => candidate.id === target.recordingId);
    const choice = entry === undefined ? undefined : watchChoiceFor(entry, now);
    if (choice !== undefined && !choice.direct) return { _tag: "Choose", choice };
  }
  return { _tag: "Play", target };
};

/**
 * OK on a guide programme: the domain's pick (`playTargetFor`) over this profile's recordings;
 * before it starts, its sheet.
 */
export const pickProgramme = (
  programme: PickedProgramme,
  entries: readonly RecordingEntry[],
  now: number,
): WatchPick => pickTarget(programmePlayTarget(programme, entries, now), entries, now);

/** OK on a recording: something to watch plays (or asks); scheduled or failed opens its page. */
export const pickRecording = (
  entry: RecordingEntry,
  entries: readonly RecordingEntry[],
  now: number,
): WatchPick =>
  isPlayable(entry)
    ? pickTarget(
        {
          _tag: "Recording",
          recordingId: entry.id,
          from: entry.watched || entry.positionMillis <= 0 ? "start" : "resume",
        },
        entries,
        now,
      )
    : { _tag: "Sheet" };
