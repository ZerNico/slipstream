import { Schema } from "effect";
import type { Collection } from "./collection.ts";
import { defaultExtraTime, EffectiveExtraTime, type ExtraTimeDefaults } from "./extra-time.ts";
import { GroupPath, groupRecording } from "./grouping.ts";
import { type AccessPolicy, GoesToOptions, goesToOptions } from "./household.ts";
import { ChannelId, CollectionId, ProgrammeId, RecordingId, RuleId, UserId } from "./ids.ts";
import type { Programme } from "./programme.ts";
import { isActive, isRecorded, type Recording, RecordingState } from "./recording.ts";
import { type EpisodeContext, RepeatRef } from "./episode.ts";
import type { GuideRepeat } from "./repeats.ts";
import { type ExistingRecording, recordingsOfAiring } from "./airing.ts";
import { recordEveryKind, seriesPrefix } from "./series-rule.ts";
import { epochMs, Instant, Padding } from "./time.ts";

/**
 * What "Record every…" offers for a programme (§3.1): a series, every broadcast, or nothing.
 * The same literals as `recordEveryKind` answers with.
 */
export const RecordEveryKind = Schema.Literals(["series", "broadcasts", "none"]);
export type RecordEveryKind = typeof RecordEveryKind.Type;

/**
 * The programme sheet's second record row: its kind ("Record series", "Record every “Live
 * F1”", or no row) and the name the series recording goes by ("Live F1", "Tatort").
 */
export const RecordEvery = Schema.Struct({
  kind: RecordEveryKind,
  name: Schema.String,
}).annotate({ identifier: "RecordEvery" });
export type RecordEvery = typeof RecordEvery.Type;

/** An airing named by programme, channel and time: the server's "Record the repeat instead". */
export const RepeatAiring = Schema.Struct({
  programmeId: ProgrammeId,
  channelId: ChannelId,
  start: Instant,
  end: Instant,
}).annotate({ identifier: "RepeatAiring" });
export type RepeatAiring = typeof RepeatAiring.Type;

/** Whether and for whom a programme is already recorded, as the caller may know it. */
export const ProgrammeRecordingStatus = Schema.TaggedUnion({
  NotScheduled: {},
  /** A recording the caller can see: scheduled, running or done. */
  Recorded: {
    recordingId: RecordingId,
    state: RecordingState,
    ruleId: Schema.optionalKey(RuleId),
    padding: Padding,
    /** The collection picked by hand, when there is one. */
    collectionId: Schema.optionalKey(CollectionId),
  },
  /**
   * Recorded for someone else into a place the caller cannot see (SPEC 7.8): "Already being
   * recorded for the household · Ask Jonas (admin) to share it". No second capture is offered.
   */
  Household: { adminId: UserId },
  /**
   * The caller can see a copy of this episode (another airing, or their history), and none of
   * their series recordings decided about this airing: "Already recorded Sun 22, 15:00 on ONE".
   * Record series and Record once stay offered.
   */
  Owned: { of: RepeatRef },
  /**
   * One of the caller's series recordings matches this airing and left it out because the
   * episode is had or scheduled: Record anyway · Series options.
   */
  Repeat: { of: RepeatRef, ruleId: RuleId },
}).annotate({ identifier: "ProgrammeRecordingStatus" });
export type ProgrammeRecordingStatus = typeof ProgrammeRecordingStatus.Type;

/**
 * Everything the programme sheet's record section needs for the caller: the default extra time
 * and where it comes from ("From your Sky Sport F1 HD default (5 min early, 60 after)", from
 * `defaultExtraTime`), the "Goes to" choices for this profile (absent when it may not record),
 * where "Automatic" would put it (the "Formel 1" of "Automatic (Formel 1)"), and whether it is
 * already recorded.
 */
export const RecordOptions = Schema.Struct({
  programmeId: ProgrammeId,
  extraTime: EffectiveExtraTime,
  goesTo: Schema.optionalKey(GoesToOptions),
  automaticGroup: GroupPath,
  status: ProgrammeRecordingStatus,
  /** The second record row, from `recordEveryKind` and `seriesPrefix`. */
  every: RecordEvery,
  /**
   * For a programme in a schedule conflict: a later airing of it the server picked for "Record
   * the repeat instead". Absent when there is none or no conflict.
   */
  repeatAiring: Schema.optionalKey(RepeatAiring),
}).annotate({ identifier: "RecordOptions" });
export type RecordOptions = typeof RecordOptions.Type;

/** What record options need of a recording; library entries and stored recordings both fit. */
export type RecordedCandidate = ExistingRecording &
  Pick<Recording, "id" | "state" | "padding" | "ownerIds"> & {
    readonly ruleId?: RuleId | undefined;
    readonly pinnedCollectionId?: CollectionId | undefined;
  };

const stateRank: Record<RecordingState, number> = {
  recording: 0,
  scheduled: 1,
  completed: 2,
  incomplete: 3,
  failed: 4,
  cancelled: 5,
};

/**
 * The recording the sheet talks about for a programme, if any: of the recordings of this airing
 * (`recordingsOfAiring`), running before scheduled before finished. Only scheduled and running
 * ones block a new recording (`isActive`); a finished one counts once the programme has
 * ended, so a programme still on air whose capture failed or ended early can be recorded again.
 */
export const recordingOfProgramme = <A extends RecordedCandidate>(
  programme: Programme,
  recordings: readonly A[],
  now: number,
): A | undefined => {
  const [first] = recordingsOfAiring(programme, recordings).toSorted(
    (a, b) => stateRank[a.state] - stateRank[b.state],
  );
  if (first === undefined) return undefined;
  return isActive(first) || epochMs(programme.end) <= now ? first : undefined;
};

/** What working out the record options for one programme and one caller needs. */
export interface RecordOptionsInput<A extends RecordedCandidate> {
  readonly programme: Programme;
  /** The programme's channel name, for `{channel}` in Automatic's group. */
  readonly channelName: string | undefined;
  /** Every recording the household has (or the caller can see). */
  readonly recordings: readonly A[];
  /** Epoch ms. */
  readonly now: number;
  readonly collections: readonly Collection[];
  /** The caller's access policy. */
  readonly access: AccessPolicy;
  /** Admins may create a collection from the sheet ("New collection…"). */
  readonly mayCreateCollections: boolean;
  /** The household's extra-time defaults (Settings › Recording). */
  readonly extraTime: ExtraTimeDefaults;
  /** The household time zone, which grouping uses for dates. */
  readonly timeZone: string;
  /**
   * Whether the caller may see where a recording goes. When not, the answer is `Household`
   * with `householdAdminId` (else the recording's first owner). Everyone sees everything when
   * absent.
   */
  readonly sees?: ((recording: A) => boolean) | undefined;
  readonly householdAdminId?: UserId | undefined;
  /**
   * Whether the caller already has this episode (from `guideRepeats` for this programme): with a
   * rule, one of the caller's series recordings left the airing out (`Repeat`); without, the
   * caller merely sees a copy (`Owned`). Only used when nothing records this airing itself, and
   * only passed when the caller may see `of`.
   */
  readonly repeat?: Pick<GuideRepeat, "of" | "ruleId"> | undefined;
  /** What identifying an episode needs (the plan's context), for the kind of "Record every…". */
  readonly episodes: EpisodeContext;
  /** The server-chosen "Record the repeat instead" airing, passed through as is. */
  readonly repeatAiring?: RepeatAiring | undefined;
}

/**
 * The programme sheet's second record row for a programme: the kind from `recordEveryKind`, and
 * the name the series recording keys on, trailing separators trimmed ("Live F1").
 */
export const recordEvery = (programme: Programme, episodes: EpisodeContext): RecordEvery => ({
  kind: recordEveryKind(programme, episodes),
  name: seriesPrefix(programme.title).name,
});

/**
 * The record options for one programme and one caller: the one composition the server's
 * `GET /api/programmes/:id/record-options` answers with and the web mock and the sheet's
 * fallback reuse. Extra time from `defaultExtraTime` (channel beats category beats global), the
 * Goes-to choices for the caller's access, Automatic's group in the household time zone, and the
 * status from `recordingOfProgramme`.
 */
export const recordOptionsFor = <A extends RecordedCandidate>(
  input: RecordOptionsInput<A>,
): RecordOptions => {
  const { programme } = input;
  const goesTo = goesToOptions(
    input.access,
    input.collections.toSorted((a, b) => a.rank - b.rank).map((collection) => collection.id),
    { mayCreateCollections: input.mayCreateCollections },
  );
  const channelName = (id: string) => (id === programme.channelId ? input.channelName : undefined);
  const automaticGroup = groupRecording({ ...programme, labels: [] }, input.collections, {
    timeZone: input.timeZone,
    channelName,
  }).path;
  const every = recordEvery(programme, input.episodes);
  const recorded = recordingOfProgramme(programme, input.recordings, input.now);
  const repeat = input.repeat;
  const status: ProgrammeRecordingStatus =
    recorded === undefined
      ? repeat === undefined
        ? { _tag: "NotScheduled" }
        : repeat.ruleId === undefined
          ? { _tag: "Owned", of: repeat.of }
          : { _tag: "Repeat", of: repeat.of, ruleId: repeat.ruleId }
      : (input.sees?.(recorded) ?? true)
        ? {
            _tag: "Recorded",
            recordingId: recorded.id,
            state: recorded.state,
            padding: recorded.padding,
            ...(recorded.ruleId === undefined ? {} : { ruleId: recorded.ruleId }),
            ...(recorded.pinnedCollectionId === undefined
              ? {}
              : { collectionId: recorded.pinnedCollectionId }),
          }
        : { _tag: "Household", adminId: input.householdAdminId ?? recorded.ownerIds[0] };
  return {
    programmeId: programme.id,
    extraTime: defaultExtraTime(input.extraTime, {
      channelIds: [programme.channelId],
      categories: programme.categories,
    }),
    ...(goesTo === undefined ? {} : { goesTo }),
    automaticGroup,
    status,
    every,
    ...(input.repeatAiring === undefined ? {} : { repeatAiring: input.repeatAiring }),
  };
};

/** The state of the programme sheet, which decides badges, the record section and the footer. */
export type RecordSheetState =
  /** Running now and recorded for the caller: Watch (choice dialog) · Edit rule. */
  | { readonly kind: "recording" }
  /** Scheduled for the caller, maybe in conflict: Skip this one · Edit rule. */
  | { readonly kind: "scheduled"; readonly conflict: boolean }
  /** Recorded and finished: Watch. */
  | { readonly kind: "recorded" }
  /** Recorded for someone else into a place the caller can't see: no second capture. */
  | { readonly kind: "household" }
  /** Ended and not recorded: no footer. */
  | { readonly kind: "ended" }
  /** Not recorded yet: Watch live + Record when on air, else Record. */
  | { readonly kind: "record"; readonly live: boolean }
  /**
   * Not recorded, but the caller sees a copy of the episode: the status line "Already recorded
   * Sun 22, 15:00 on ONE · Play it" above both record rows; the footer as for `record`.
   */
  | { readonly kind: "owned"; readonly live: boolean; readonly of: RepeatRef }
  /**
   * One of the caller's series recordings left this airing out: the status box replaces the
   * record rows; Record anyway · Series options (Watch live · Record anyway when on air).
   */
  | {
      readonly kind: "repeat";
      readonly live: boolean;
      readonly of: RepeatRef;
      readonly ruleId: RuleId;
    };

/**
 * Decides the programme sheet's state (SPEC §8.3) from the record options, the clock (epoch ms)
 * and whether the recording is in a schedule conflict. The web sheet and the TV sheet both read
 * it.
 */
export const recordSheetState = (
  options: Pick<RecordOptions, "status">,
  programme: { readonly start: number; readonly end: number },
  now: number,
  inConflict: boolean,
): RecordSheetState => {
  const { status } = options;
  const ended = programme.end <= now;
  const live = programme.start <= now && !ended;
  if (status._tag === "Household") return { kind: "household" };
  if (status._tag === "Recorded") {
    if (status.state === "recording") return { kind: "recording" };
    if (status.state === "scheduled") return { kind: "scheduled", conflict: inConflict };
    if (isRecorded(status)) return { kind: "recorded" };
  }
  if (ended) return { kind: "ended" };
  if (status._tag === "Owned") return { kind: "owned", live, of: status.of };
  if (status._tag === "Repeat") {
    return { kind: "repeat", live, of: status.of, ruleId: status.ruleId };
  }
  return { kind: "record", live };
};

/**
 * The schedule conflict a recording is part of, if any. Structural, so the API's
 * `ScheduleConflict` fits without the domain depending on the API.
 */
export const scheduleConflictFor = <C extends { readonly recordingIds: ReadonlyArray<string> }>(
  recordingId: string,
  conflicts: ReadonlyArray<C>,
): C | undefined => conflicts.find((conflict) => conflict.recordingIds.includes(recordingId));
