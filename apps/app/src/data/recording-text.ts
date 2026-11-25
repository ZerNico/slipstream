import type { RecordingEntry, ScheduleConflict } from "@slipstream/api";
import {
  epochMs,
  isProblemRecording,
  problemChains,
  recordingGapSummary,
  type UserId,
} from "@slipstream/domain";
import { type ConflictWords, conflictText, conflictTitle, m, rerunText } from "@slipstream/i18n";
import { householdZone } from "./zone.ts";

/*
 * What the recording sheet and the "To do" row say about a recording, in every client's words
 * (@slipstream/i18n): one problem line with the state of the repeat, and the conflict cards.
 */

/** What the texts read from a recording. */
type TextEntry = Pick<
  RecordingEntry,
  | "id"
  | "title"
  | "state"
  | "problems"
  | "start"
  | "end"
  | "padding"
  | "sizeBytes"
  | "rerun"
  | "protected"
  | "replaces"
>;

/** A problem in one line: failed (nothing to watch) or what is missing, with the repeat. */
export interface ProblemLine {
  readonly failed: boolean;
  readonly text: string;
}

/**
 * The recording's problem as the web's recording page says it: "Recording failed", or "2 min
 * missing · Recording the repeat today 00:00". Nothing for a good recording.
 */
export const problemLine = (
  entry: TextEntry,
  entries: readonly TextEntry[],
  now: number,
): ProblemLine | undefined => {
  if (!isProblemRecording(entry)) return undefined;
  const summary = recordingGapSummary(entry);
  const rerun = rerunText(entry, now, householdZone(), entries);
  const first = summary.failed
    ? m.library_problem_failed()
    : m.library_card_missing({ seconds: Math.round(summary.missingMs / 1000) });
  return {
    failed: summary.failed,
    text: [first, rerun].filter((part) => part !== undefined).join(" · "),
  };
};

/**
 * A conflict in the words every client uses: how many overlap, when, the server's room then
 * (`capacity`: how many can record at once) and the titles of the recordings it knows.
 */
export const conflictWords = (
  conflict: ScheduleConflict,
  recordings: readonly { readonly id: string; readonly title: string }[],
): ConflictWords => {
  const titles = new Map(recordings.map((recording) => [recording.id, recording.title]));
  return {
    count: conflict.recordingIds.length,
    from: epochMs(conflict.range.start),
    to: epochMs(conflict.range.end),
    room:
      conflict.capacity > 0
        ? { kind: "limit", streams: conflict.capacity }
        : { kind: "free", streams: 0 },
    titles: conflict.recordingIds.flatMap((id) => {
      const title = titles.get(id);
      return title === undefined ? [] : [title];
    }),
  };
};

/** One card of the "To do" row. */
export type TodoItem =
  | {
      readonly kind: "recording";
      readonly id: string;
      readonly entry: RecordingEntry;
      readonly failed: boolean;
      readonly title: string;
      readonly text: string;
    }
  | {
      readonly kind: "conflict";
      readonly id: string;
      readonly title: string;
      readonly text: string;
    };

/** What the "To do" row is made from. */
export interface TodoData {
  readonly me: UserId | undefined;
  readonly admin: boolean;
  readonly recordings: readonly RecordingEntry[];
  readonly conflicts: readonly ScheduleConflict[];
  readonly now: number;
}

/**
 * The "To do" row, as the web's Home lists it: failed recordings, then the incomplete ones (one
 * card per damaged recording and its repeats), newest first, then conflicts for an admin. Every
 * profile sees the problems of its own recordings; an admin sees everyone's.
 */
export const todoItems = (data: TodoData): readonly TodoItem[] => {
  const own = data.recordings.filter(
    (entry) => data.admin || (data.me !== undefined && entry.ownerIds.includes(data.me)),
  );
  const recordings = problemChains(own).map((entry): TodoItem => {
    const problem = problemLine(entry, own, data.now);
    const failed = problem?.failed ?? false;
    const repeat = entry.rerun !== undefined && !failed;
    return {
      kind: "recording",
      id: `recording:${entry.id}`,
      entry,
      failed,
      title: failed
        ? m.library_failed_title({ title: entry.title })
        : repeat
          ? m.home_issue_gaps_title({ title: entry.title })
          : m.library_incomplete_title({ title: entry.title }),
      text: problem?.text ?? "",
    };
  });
  const conflicts = data.admin
    ? data.conflicts.map((conflict): TodoItem => ({
        kind: "conflict",
        id: `conflict:${epochMs(conflict.range.start)}:${conflict.recordingIds.join("+")}`,
        title: conflictTitle(epochMs(conflict.range.start), data.now, householdZone()),
        text: conflictText(conflictWords(conflict, data.recordings)),
      }))
    : [];
  return [
    ...recordings.filter((item) => item.kind === "recording" && item.failed),
    ...recordings.filter((item) => item.kind === "recording" && !item.failed),
    ...conflicts,
  ];
};
