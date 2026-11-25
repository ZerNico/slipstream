import type { RecordingRequest, ScheduleConflict } from "@slipstream/api";
import {
  type ChannelId,
  type CollectionId,
  epochMs,
  type Padding,
  type GuideEntry,
  type ProgrammeId,
  type RecordEvery,
  type RecordingId,
  type RecordOptions,
  type RecordSheetState,
  recordSheetState,
  type RepeatKind,
  repeatKind,
  scheduleConflictFor,
  stepPaddingMinutes,
} from "@slipstream/domain";

/** What the sheet is about: the focused guide programme. */
export interface SheetProgramme {
  readonly programmeId: ProgrammeId;
  readonly channelId: ChannelId;
  readonly title: string;
  /** Epoch ms. */
  readonly start: number;
  readonly end: number;
}

/** The sheet's view of a guide entry: its id, channel, title and times in epoch ms. */
export const sheetProgramme = (programme: GuideEntry): SheetProgramme => ({
  programmeId: programme.id,
  channelId: programme.channelId,
  title: programme.title,
  start: epochMs(programme.start),
  end: epochMs(programme.end),
});

/** Which side of the padding a stepper changes. */
export type PaddingSide = "beforeMinutes" | "afterMinutes";

/**
 * Moves one side of the padding to the domain's next stepper value left (-1) or right (+1), up
 * to `paddingLimits.max`. A value between steps (from a rule) moves to the neighbouring step in
 * that direction; the ends hold.
 */
export const stepPadding = (padding: Padding, side: PaddingSide, direction: 1 | -1): Padding => ({
  ...padding,
  [side]: stepPaddingMinutes(padding[side], direction),
});

/** One row of the sheet, top to bottom. */
export type SheetOption =
  /** Record this programme once. */
  | "record"
  /** "Record series" / "Record every …": a series recording (`SheetPlan.every`). */
  | "every"
  /** "Record anyway": a one-off of an airing a series recording left out as a repeat. */
  | "anyway"
  /** The start-early and keep-after steppers. */
  | "extraTime"
  /** "Skip this one": take the scheduled recording off the schedule. */
  | "skip"
  /** Open the recording: at its live edge while it runs, else where this profile left off. */
  | "watch"
  /** A notice when the programme starts. */
  | "remind";

/** What the sheet shows for one programme, from the server's record options. */
export interface SheetPlan {
  /** The domain's sheet state (SPEC §8.3), which the web sheet reads too. */
  readonly state: RecordSheetState;
  readonly options: readonly SheetOption[];
  /**
   * The every row as the server worked it out (`RecordOptions.every`): "Record series" or
   * "Record every “Live F1”" and the name it uses. Undefined when there is no such row (a film).
   */
  readonly every: RecordEvery | undefined;
  /** The recording the sheet acts on (skip, extra time, watch), when there is one. */
  readonly recordingId: RecordingId | undefined;
  /** The schedule conflict that recording is in, as the server reported it. */
  readonly conflict: ScheduleConflict | undefined;
  /**
   * Where a new recording goes when the profile may only record into its own collections
   * ("Goes to" starts on a collection); undefined lets the server decide (Automatic).
   */
  readonly collectionId: CollectionId | undefined;
  /** The extra time the steppers start from: the recording's own, else the default. */
  readonly padding: Padding;
}

/**
 * The sheet for `programme` at `now`: the state from `recordSheetState`, in conflict only when
 * the server's conflicts name the programme's own recording (`scheduleConflictFor`). Recording
 * is offered only to a profile with "Goes to" choices, the every row only when the server's
 * `every` is of the `series` or `broadcasts` kind. A viewer who already has the episode (`owned`) keeps both
 * rows; an airing one of the viewer's series recordings left out (`repeat`) offers "Record
 * anyway" in place of them. A scheduled recording can be skipped or get other extra time; a
 * running or finished one can be watched; a recording for the household the profile cannot see
 * offers nothing to record. A reminder only makes sense before the start.
 */
export const sheetPlan = (
  options: RecordOptions,
  programme: SheetProgramme,
  conflicts: readonly ScheduleConflict[],
  now: number,
): SheetPlan => {
  const { status, goesTo } = options;
  const every = options.every.kind === "none" ? undefined : options.every;
  const recordingId = status._tag === "Recorded" ? status.recordingId : undefined;
  const conflict =
    recordingId === undefined ? undefined : scheduleConflictFor(recordingId, conflicts);
  const state = recordSheetState(options, programme, now, conflict !== undefined);
  const remind: readonly SheetOption[] = programme.start > now ? ["remind"] : [];
  const records = goesTo !== undefined;
  const recordRows: readonly SheetOption[] =
    every === undefined ? ["record", "extraTime"] : ["record", "every", "extraTime"];
  const sheetOptions: readonly SheetOption[] =
    state.kind === "record" || state.kind === "owned"
      ? [...(records ? recordRows : []), ...remind]
      : state.kind === "repeat"
        ? [...(records ? (["anyway", "extraTime"] as const) : []), ...remind]
        : state.kind === "scheduled"
          ? ["skip", "extraTime", ...remind]
          : state.kind === "recording" || state.kind === "recorded"
            ? ["watch"]
            : state.kind === "household"
              ? remind
              : [];
  return {
    state,
    options: sheetOptions,
    every,
    recordingId,
    conflict: state.kind === "scheduled" ? conflict : undefined,
    collectionId: goesTo?.initial._tag === "Collection" ? goesTo.initial.collectionId : undefined,
    padding:
      state.kind === "scheduled" && status._tag === "Recorded"
        ? status.padding
        : options.extraTime.padding,
  };
};

/**
 * "Record this programme" (and "Record anyway"): a one-off recording of the guide entry, owned
 * by the viewer and by no series recording. Padding goes along only when the person changed
 * it, otherwise the server applies the default extra time itself; the collection only when the
 * profile records into one of its own.
 */
export const recordOnceRequest = (
  programme: SheetProgramme,
  padding: Padding | undefined,
  collectionId: CollectionId | undefined,
): RecordingRequest => ({
  _tag: "Programme",
  programmeId: programme.programmeId,
  ...(padding === undefined ? {} : { padding }),
  ...(collectionId === undefined ? {} : { collectionId }),
});

/** What the status line says about the viewer's copy of an `owned` or `repeat` airing. */
export interface RepeatStatus {
  /** The domain's `repeatKind`: recorded (or recording now), scheduled, or deleted. */
  readonly kind: RepeatKind;
  readonly start: Date;
  /** The copy's channel, only when it differs from this airing's. */
  readonly channelId: ChannelId | undefined;
  /** The copy to play ("Play it"): only for a recorded one the viewer can open. */
  readonly recordingId: RecordingId | undefined;
}

/**
 * The status line for an airing the viewer already has: "Already recorded Sun 22, 15:00 on
 * ONE", "Already scheduled …" or "You had this episode (recorded Sun 22). It was deleted." The
 * channel is named only when it differs from this airing's; a recorded copy with its recording
 * id can be played from the line. Undefined for every other state.
 */
export const repeatStatus = (
  state: RecordSheetState,
  programme: Pick<SheetProgramme, "channelId">,
): RepeatStatus | undefined => {
  if (state.kind !== "owned" && state.kind !== "repeat") return undefined;
  const { of } = state;
  const kind = repeatKind(of);
  return {
    kind,
    start: new Date(epochMs(of.start)),
    channelId: of.channelId === programme.channelId ? undefined : of.channelId,
    recordingId: kind === "recorded" ? of.recordingId : undefined,
  };
};
