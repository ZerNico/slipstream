import { Schema } from "effect";
import { CollectionId, ProgrammeId, RecordingId, RuleId, UserId } from "./ids.ts";
import { ProgrammeInfo } from "./programme.ts";
import { Instant, overlaps, Padding, padRange, summariseGaps, TimeRange } from "./time.ts";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** How long recordings of a rule or collection are kept (PLAN 6.6). */
export const Retention = Schema.TaggedUnion({
  KeepAll: {},
  KeepNewest: { count: PositiveInt },
  /** Newest N events, for collections whose layout has an event part. */
  KeepNewestEvents: { count: PositiveInt },
  KeepDays: { days: PositiveInt },
}).annotate({ identifier: "Retention" });
export type Retention = typeof Retention.Type;

/**
 * The terminal outcomes of a search for a repeat (§3.7): both copies kept, stopped by the
 * person, or given up after the deadline or two failed repeats. Everything else is derived.
 */
export const RerunOutcome = Schema.Literals(["kept", "declined", "exhausted"]);
export type RerunOutcome = typeof RerunOutcome.Type;

/** Why a recording left the library: replaced by its repeat, or deleted while its chain runs. */
export const HiddenReason = Schema.Literals(["deleted", "replaced"]);
export type HiddenReason = typeof HiddenReason.Type;

/** Lifecycle of a recording. */
export const RecordingState = Schema.Literals([
  "scheduled",
  "recording",
  "completed",
  "incomplete",
  "failed",
  "cancelled",
]);
export type RecordingState = typeof RecordingState.Type;

/** What went wrong with a recording, shown as "source down 12:04 to 12:06" and similar. */
export const RecordingProblem = Schema.TaggedUnion({
  SourceUnreachable: { range: TimeRange, retries: Schema.Int },
  SourceLimitReached: { range: TimeRange },
  NoData: {},
  Gap: { range: TimeRange },
}).annotate({ identifier: "RecordingProblem" });
export type RecordingProblem = typeof RecordingProblem.Type;

/** Export of a finished recording into the library path template. */
export const ExportStatus = Schema.Literals(["none", "pending", "done", "failed"]);
export type ExportStatus = typeof ExportStatus.Type;

/**
 * A retained time range on a channel. The guide fields are a snapshot taken when it was
 * scheduled, so later guide changes never rename a recording; `start`/`end` are the programme
 * times and `padding` widens them.
 */
export const Recording = Schema.Struct({
  id: RecordingId,
  programmeId: Schema.optionalKey(ProgrammeId),
  ...ProgrammeInfo.fields,
  padding: Padding,
  /**
   * Who set `padding`: `user` once someone changed it on this recording (extra time, "End
   * early"), so re-planning a rule keeps it. Absent or `rule`: derived from the rule or the
   * household defaults, and re-planning recomputes it.
   */
  paddingSource: Schema.optionalKey(Schema.Literals(["rule", "user"])),
  state: RecordingState,
  problems: Schema.Array(RecordingProblem),
  ruleId: Schema.optionalKey(RuleId),
  /** Two people recording the same programme share one recording with two owners. */
  ownerIds: Schema.NonEmptyArray(UserId),
  protected: Schema.Boolean,
  labels: Schema.Array(Schema.String),
  /** Set when someone moved the recording into a collection by hand. */
  pinnedCollectionId: Schema.optionalKey(CollectionId),
  exportStatus: ExportStatus,
  createdAt: Instant,
  /**
   * Set on a repeat recorded because an earlier recording of the episode needs one (§3.7): the
   * original, the first damaged recording of the chain, never an earlier repeat.
   */
  replacesId: Schema.optionalKey(RecordingId),
  /** Set on the original once a good repeat replaced it. */
  replacedById: Schema.optionalKey(RecordingId),
  /**
   * When it left the library: replaced by its repeat, or deleted while its chain still looks
   * for a repeat. Hidden recordings are left out of lists, counts and retention.
   */
  hiddenAt: Schema.optionalKey(Instant),
  /**
   * Why it is hidden: `replaced` by its repeat, or `deleted` by a person while its chain still
   * looks for a repeat (an anchor). Set together with `hiddenAt`.
   */
  hiddenReason: Schema.optionalKey(HiddenReason),
  /** How the search for a repeat ended, when it ended other than by a replacement. */
  rerunOutcome: Schema.optionalKey(RerunOutcome),
  /** Until when the search for a repeat runs: the programme end plus 14 days. */
  rerunUntil: Schema.optionalKey(Instant),
  /** Repeats of this original that ended needing a repeat themselves; absent means 0. */
  rerunAttempts: Schema.optionalKey(NonNegativeInt),
}).annotate({ identifier: "Recording" });
export type Recording = typeof Recording.Type;

/** Whether a recording has left the library (replaced, or deleted while its chain runs). */
export const isHidden = (recording: { readonly hiddenAt?: Instant | undefined }): boolean =>
  recording.hiddenAt !== undefined;

/**
 * Whether a recording is an anchor: deleted by a person while its chain still looks for a
 * repeat. It stays hidden and holds the chain; its repeat never offers "Keep the original".
 */
export const isAnchor = (recording: Pick<Recording, "hiddenAt" | "hiddenReason">): boolean =>
  recording.hiddenAt !== undefined && recording.hiddenReason === "deleted";

/*
 * The states read as groups, named once so every client draws the same lines: active (still to
 * come or running), playable (holds segments) and recorded (finished with something captured).
 */

/**
 * Whether a recording is still to come or running. Only these stand in the way of recording the
 * same airing again: a completed, incomplete or failed recording of a programme still on air
 * does not, so it can be recorded again.
 */
export const isActive = (recording: Pick<Recording, "state">): boolean =>
  recording.state === "scheduled" || recording.state === "recording";

/** The states that hold segments to watch: running, finished, or finished with holes. */
export const playableStates = ["recording", "completed", "incomplete"] as const;
export type PlayableState = (typeof playableStates)[number];

/** Whether a recording holds something to watch (`playableStates`). */
export const isPlayable = <R extends Pick<Recording, "state">>(
  recording: R,
): recording is R & { readonly state: PlayableState } =>
  (playableStates as ReadonlyArray<RecordingState>).includes(recording.state);

/** Whether a recording finished with something captured: completed or incomplete. */
export const isRecorded = (recording: Pick<Recording, "state">): boolean =>
  recording.state === "completed" || recording.state === "incomplete";

/**
 * The chain a recording belongs to (§3.7): a damaged original and its repeats are one chain,
 * named by the original, which every repeat's `replacesId` points at.
 */
export const chainOf = <
  R extends { readonly id?: string | undefined; readonly replacesId?: string | undefined },
>(
  recording: R,
): NonNullable<R["replacesId"]> | R["id"] => recording.replacesId ?? recording.id;

/** Failed or incomplete: something to fix or know about. */
export const isProblemRecording = (recording: Pick<Recording, "state">): boolean =>
  recording.state === "failed" || recording.state === "incomplete";

/** The tags of the problems that report a missing stretch (see `RangedProblem`). */
export type RangedProblemTag = "Gap" | "SourceUnreachable" | "SourceLimitReached";

/**
 * The problems that report a missing stretch, the one fixed set every gap list reads: a plain
 * gap, the source unreachable, and every stream busy at the source. All three mean the same to
 * a viewer (nothing was captured from there to there) and differ only in why. `NoData` has no
 * range: it says nothing arrived at all, which `recordingGapSummary` reads as failed.
 */
export type RangedProblem = Extract<RecordingProblem, { readonly _tag: RangedProblemTag }>;

/** Most telling first: every stream busy, then the source unreachable, else a plain gap. */
const causeRank: Record<RangedProblemTag, number> = {
  SourceLimitReached: 0,
  SourceUnreachable: 1,
  Gap: 2,
};

/** Whether a problem reports a missing stretch (see `RangedProblem`). */
export const isRangedProblem = (problem: RecordingProblem): problem is RangedProblem =>
  problem._tag in causeRank;

/** One merged missing stretch and why it is missing. */
export interface RecordingGap {
  readonly range: TimeRange;
  /** The most telling report inside the stretch: every stream busy, unreachable, else a gap. */
  readonly cause: RangedProblemTag;
  /** The most retries an unreachable report inside it made; 0 when none. */
  readonly retries: number;
}

/** What a recording misses, ready to show. */
export interface RecordingGapSummary {
  /**
   * Nothing usable was captured: the recording failed, the gaps cover the whole window, or the
   * source sent no data and no stretch was reported. It then reads as failed, whatever its state.
   */
  readonly failed: boolean;
  /** Merged, clipped to the padded window, in time order. */
  readonly gaps: ReadonlyArray<RecordingGap>;
  /** How much of the padded window is missing, overlaps counted once. */
  readonly missingMs: number;
}

/**
 * The one reading of a recording's problems every client shows (SPEC 8.4): its ranged problems
 * merged and clipped to the padded window (`summariseGaps`), each stretch with its dominant
 * cause, and whether the recording counts as failed.
 */
export const recordingGapSummary = (
  recording: Pick<Recording, "state" | "problems" | "start" | "end" | "padding">,
): RecordingGapSummary => {
  const reports = recording.problems.filter(isRangedProblem);
  const summary = summariseGaps(
    reports.map((report) => report.range),
    padRange(recording, recording.padding),
  );
  const noData = recording.problems.some((problem) => problem._tag === "NoData");
  const gaps = summary.gaps.map((range): RecordingGap => {
    const inside = reports.filter((report) => overlaps(report.range, range));
    const cause = inside.reduce<RangedProblemTag>(
      (best, report) => (causeRank[report._tag] < causeRank[best] ? report._tag : best),
      "Gap",
    );
    const retries = inside.reduce(
      (most, report) =>
        report._tag === "SourceUnreachable" ? Math.max(most, report.retries) : most,
      0,
    );
    return { range, cause, retries };
  });
  return {
    failed: recording.state === "failed" || summary.coversWindow || (noData && gaps.length === 0),
    gaps,
    missingMs: summary.missingMs,
  };
};
