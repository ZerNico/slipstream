import { needsRepeat, type RecordingId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { formatClock, formatPosition } from "~/i18n/formats.ts";
import type { DeleteRecordingInput } from "~/api/mutations.ts";
import { recordedSpan, resumeMillis, type Entry } from "./library.ts";

/**
 * The detail page's primary action (SPEC §7.6, §8.4, open issue on running recordings). Anything
 * that already started opens the watch choice; only an untouched finished recording plays
 * directly from the start.
 *
 * - `resumeAt`: running, with a resume position (wall clock, "Resume at 18:11").
 * - `watch`: running, not started by this profile.
 * - `resumeFrom`: finished, started ("Resume from 46:30").
 * - `play`: finished, not started.
 * - `none`: failed or not captured yet.
 */
export type PrimaryAction =
  | { readonly kind: "resumeAt"; readonly at: number }
  | { readonly kind: "watch" }
  | { readonly kind: "resumeFrom"; readonly position: number }
  | { readonly kind: "play" }
  | { readonly kind: "none" };

/** Works out the primary action for a recording. */
export const primaryAction = (entry: Entry): PrimaryAction => {
  const position = resumeMillis(entry);
  switch (entry.state) {
    case "recording":
      return position === undefined
        ? { kind: "watch" }
        : { kind: "resumeAt", at: recordedSpan(entry).start + position };
    case "completed":
    case "incomplete":
      return position === undefined ? { kind: "play" } : { kind: "resumeFrom", position };
    case "scheduled":
    case "failed":
    case "cancelled":
      return { kind: "none" };
  }
};

/** The primary action's label (SPEC §7.9: wall clock while running, position once finished). */
export const primaryLabel = (entry: Entry): string => {
  const action = primaryAction(entry);
  switch (action.kind) {
    case "resumeAt":
      return m.choice_resume_at({ clock: formatClock(action.at) });
    case "watch":
      return m.player_watch();
    case "resumeFrom":
      return m.choice_resume_from({ position: formatPosition(action.position) });
    case "play":
    case "none":
      return m.player_play();
  }
};

/** Whether playing opens the choice dialog instead of the player. */
export const opensChoice = (action: PrimaryAction): boolean =>
  action.kind === "resumeAt" || action.kind === "watch" || action.kind === "resumeFrom";

/** The "Exported as" fact (SPEC §8.4): done, planned for when it ends, nothing, or export off. */
export type ExportFact =
  | { readonly kind: "done"; readonly path: string }
  | { readonly kind: "planned"; readonly path: string }
  | { readonly kind: "nothingCaptured" }
  | { readonly kind: "off" };

/** Works out the export fact. A running recording is never "exported" yet. */
export const exportFact = (entry: Entry): ExportFact => {
  if (entry.state === "failed") return { kind: "nothingCaptured" };
  if (entry.exportPath === undefined) return { kind: "off" };
  return entry.state === "recording" || entry.state === "scheduled"
    ? { kind: "planned", path: entry.exportPath }
    : { kind: "done", path: entry.exportPath };
};

/**
 * What deleting a finished recording asks (SPEC §8.4, recording model §3.6–§3.7):
 *
 * - `episode`: a good episode of a series recording set to "Only episodes you don't have yet".
 *   Deleting it keeps it out of later repeats (history), unless "Delete, record it again when
 *   repeated" (`history=skip`).
 * - `damaged`: a recording of a series recording that needs a repeat and still looks for one.
 *   Deleting it keeps looking ("Slipstream still records the repeat."), unless "Delete and stop
 *   looking for a repeat" (`rerun=stop`). It never writes history.
 * - `plain`: everything else, one Delete.
 */
export type DeleteChoice = "episode" | "damaged" | "plain";

/** Works out the delete confirm's variant for a recording and the series recording it is from. */
export const deleteChoice = (
  entry: Pick<Entry, "state" | "problems" | "start" | "end" | "padding" | "ruleId" | "rerun">,
  rule: { readonly skipRepeats: boolean } | undefined,
): DeleteChoice => {
  if (entry.ruleId === undefined || rule === undefined) return "plain";
  if (entry.state !== "completed" && entry.state !== "incomplete" && entry.state !== "failed") {
    return "plain";
  }
  if (needsRepeat(entry)) {
    const state = entry.rerun?.state;
    return state === "looking" || state === "scheduled" ? "damaged" : "plain";
  }
  return rule.skipRepeats ? "episode" : "plain";
};

/**
 * What a delete confirm's button sends: Delete alone, or its variant's second button ("Delete,
 * record it again when repeated" skips the history, "Delete and stop looking for a repeat"
 * stops the search).
 */
export const deleteRequest = (
  id: RecordingId,
  choice: DeleteChoice,
  second: boolean,
): DeleteRecordingInput =>
  !second || choice === "plain"
    ? { id }
    : choice === "episode"
      ? { id, history: "skip" }
      : { id, rerun: "stop" };
