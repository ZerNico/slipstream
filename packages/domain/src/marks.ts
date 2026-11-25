import type { RepeatRef } from "./episode.ts";
import type { RecordingId, RuleId } from "./ids.ts";
import type { Recording, RecordingState } from "./recording.ts";
import type { GuideRepeat } from "./repeats.ts";
import { type Airing, type AiringRecording, recordingsOfAiring } from "./airing.ts";

/**
 * What a guide marks on a programme. Colour is never the only signal (a label goes with it).
 * `repeat`: the viewer already has the episode (a quiet check, "already recorded").
 */
export type MarkState = "recording" | "scheduled" | "conflict" | "repeat";

/** A programme's marker and the recording behind it. */
export type ProgrammeMark =
  | {
      readonly state: "recording" | "scheduled" | "conflict";
      readonly recordingId: RecordingId;
      readonly ruleId?: RuleId | undefined;
    }
  | {
      readonly state: "repeat";
      /** The copy the viewer has; absent for a deleted episode (history). */
      readonly recordingId?: RecordingId | undefined;
      /** The viewer's series recording that left the airing out, if one did. */
      readonly ruleId?: RuleId | undefined;
      readonly of: RepeatRef;
    };

/** What marking needs of a recording; library entries and plain recordings both fit. */
export type MarkedRecording = AiringRecording &
  Pick<Recording, "id"> & {
    readonly ruleId?: RuleId | undefined;
  };

/** Only running and scheduled recordings mark a programme; running ones win. */
const markRank: Partial<Record<RecordingState, number>> = { recording: 0, scheduled: 1 };

const rank = (recording: MarkedRecording): number =>
  markRank[recording.state] ?? Number.POSITIVE_INFINITY;

const best = (recordings: readonly MarkedRecording[]): MarkedRecording | undefined =>
  recordings.reduce<MarkedRecording | undefined>(
    (found, recording) =>
      found === undefined || rank(recording) < rank(found) ? recording : found,
    undefined,
  );

/**
 * Markers by programme id, for the web guide and the TV guide alike: a red dot while it
 * records, an amber ring when scheduled, orange when a schedule conflict names the scheduled
 * recording. Finished, failed and cancelled recordings mark nothing. Each programme of
 * `programmes` is marked from its recordings by the one rule every client shares
 * (`recordingsOfAiring`: the same guide entry, the same title on the channel at an overlapping
 * time, or a manual recording covering it). A recording whose guide entry is not among
 * `programmes` still marks that entry by its id. Airings the viewer already has (`repeats`,
 * from `GET /guide/repeats`) get the quiet `repeat` mark unless a recording marks them.
 */
export const programmeMarks = (
  recordings: readonly MarkedRecording[],
  conflicts: readonly { readonly recordingIds: readonly RecordingId[] }[],
  programmes: readonly Airing[] = [],
  repeats: readonly Pick<GuideRepeat, "programmeId" | "ruleId" | "of">[] = [],
): ReadonlyMap<string, ProgrammeMark> => {
  const inConflict = new Set<string>(conflicts.flatMap((conflict) => conflict.recordingIds));
  const marking = recordings.filter((recording) => markRank[recording.state] !== undefined);
  const byProgramme = new Map<string, MarkedRecording>();
  for (const recording of marking) {
    if (recording.programmeId === undefined) continue;
    const current = byProgramme.get(recording.programmeId);
    if (current === undefined || rank(recording) < rank(current)) {
      byProgramme.set(recording.programmeId, recording);
    }
  }
  for (const programme of programmes) {
    const found = best(recordingsOfAiring(programme, marking));
    if (found !== undefined) byProgramme.set(programme.id, found);
  }
  const marks = new Map<string, ProgrammeMark>();
  for (const repeat of repeats) {
    if (byProgramme.has(repeat.programmeId)) continue;
    marks.set(repeat.programmeId, {
      state: "repeat",
      recordingId: repeat.of.recordingId,
      ruleId: repeat.ruleId,
      of: repeat.of,
    });
  }
  for (const [programmeId, recording] of byProgramme) {
    const state: MarkState =
      recording.state === "recording"
        ? "recording"
        : inConflict.has(recording.id)
          ? "conflict"
          : "scheduled";
    marks.set(programmeId, { state, recordingId: recording.id, ruleId: recording.ruleId });
  }
  return marks;
};
