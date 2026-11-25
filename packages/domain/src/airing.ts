import type { ChannelId, ProgrammeId } from "./ids.ts";
import type { Programme } from "./programme.ts";
import type { Recording } from "./recording.ts";
import { normaliseText } from "./title.ts";
import { epochMs, type Instant, overlaps } from "./time.ts";

/*
 * Airings: one broadcast of a programme, and the comparisons that ask whether two entries are the
 * same broadcast (a guide that lists it twice, a refresh that re-ids it, a recording of it).
 */

/** A recording that is already scheduled or exists, as duplicate detection sees it. */
export interface ExistingRecording {
  readonly channelId: ChannelId;
  readonly programmeId?: ProgrammeId | undefined;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly start: Instant;
  readonly end: Instant;
}

const sameAiring = (a: ExistingRecording, b: ExistingRecording): boolean =>
  a.channelId === b.channelId &&
  normaliseText(a.title).toLowerCase() === normaliseText(b.title).toLowerCase() &&
  normaliseText(a.subtitle ?? "").toLowerCase() === normaliseText(b.subtitle ?? "").toLowerCase() &&
  overlaps(a, b);

/**
 * Returns the existing recording a programme duplicates: the same guide entry, or the same
 * title and sub-title on the same channel at an overlapping time (guides that list a programme
 * twice, or a guide refresh that re-ids it).
 */
export const findDuplicate = <A extends ExistingRecording>(
  candidate: ExistingRecording,
  existing: ReadonlyArray<A>,
): A | undefined =>
  existing.find(
    (recording) =>
      (candidate.programmeId !== undefined && recording.programmeId === candidate.programmeId) ||
      sameAiring(candidate, recording),
  );

/**
 * The guide entry an airing's recordings are looked up for. The sub-title is optional: when
 * given, a same-title match also needs the same sub-title (`findDuplicate`).
 */
export type Airing = Pick<Programme, "id" | "channelId" | "title" | "start" | "end"> & {
  readonly subtitle?: string | undefined;
};

/** What `recordingsOfAiring` needs of a recording; library entries and stored ones both fit. */
export type AiringRecording = ExistingRecording & Pick<Recording, "state">;

/**
 * The recordings of one airing, the one definition the record sheet, the guide marks and every
 * player's pick share. A recording belongs to the airing when it duplicates it
 * (`findDuplicate`: the same guide entry, or the same title on the channel at an overlapping
 * time, so a guide refresh that re-ids the programme keeps its recording) or when it is a manual
 * recording (no guide entry) on the channel that covers the whole programme. Failed and
 * cancelled recordings hold nothing of it and never count. Order is kept.
 */
export const recordingsOfAiring = <A extends AiringRecording>(
  programme: Airing,
  recordings: ReadonlyArray<A>,
): Array<A> => {
  const candidate: ExistingRecording = { ...programme, programmeId: programme.id };
  return recordings.filter(
    (recording) =>
      recording.state !== "failed" &&
      recording.state !== "cancelled" &&
      (findDuplicate(candidate, [recording]) !== undefined ||
        (recording.programmeId === undefined &&
          recording.channelId === programme.channelId &&
          epochMs(recording.start) <= epochMs(programme.start) &&
          epochMs(recording.end) >= epochMs(programme.end))),
  );
};
