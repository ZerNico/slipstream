import {
  type EpisodeHistoryEntry,
  type EpisodeRecording,
  findRepeatAiring,
  genericSubtitles,
} from "./episode.ts";
import type { ChannelId, RuleId, UserId } from "./ids.ts";
import type { Programme } from "./programme.ts";
import type { RepeatAiring } from "./record-options.ts";
import { isActive, type RecordingState } from "./recording.ts";
import {
  type PlanExisting,
  type PlannedRecording,
  planRecordings,
  type PlanningContext,
  type SkippedMatch,
} from "./planner.ts";
import type { Rule } from "./rule.ts";
import { DAY, epochMs, type Instant, type Padding, padRange, type TimeRange } from "./time.ts";

/*
 * The household's plan (recording model §5.2): the one planner the scheduler, the server and
 * the web mock run, in at most two passes so an item the sources cannot serve moves to a later
 * airing of its episode.
 */

/** Recordings planning reads to tell episodes apart: those that ended in the last 30 days (§4.1). */
export const genericLookbackMs = 30 * DAY;

/** A planned or scheduled item, for asking whether the sources can serve it. */
export interface ServiceCandidate {
  /** A recording id, or a programme id for an item only planned so far. */
  readonly id: string;
  readonly channelId: ChannelId;
  /** The padded range it would record. */
  readonly range: TimeRange;
}

/**
 * Everything planning needs beyond rules, guide and recordings: who had which episode, who may
 * see what, the channel names, and which items the sources cannot serve together. The
 * recorder's `PlanningAccess` port has this shape.
 */
export interface PlanningAccess {
  /** Deleted episodes, every owner's. */
  readonly history: ReadonlyArray<EpisodeHistoryEntry>;
  /** Whether a person may see a recording (`seesRecording`); planned airings fit too. */
  readonly sees: (ownerId: UserId, recording: EpisodeRecording) => boolean;
  /** Whether a person may see a channel. */
  readonly seesChannel: (ownerId: UserId, channelId: ChannelId) => boolean;
  /** Channel names, so a sub-title naming the channel never identifies an episode. */
  readonly channelName: (channelId: ChannelId) => string | undefined;
  /** The ids of the items the sources cannot serve together, from the conflict detection. */
  readonly unserved: (items: ReadonlyArray<ServiceCandidate>) => ReadonlySet<string>;
}

/** What the household plan reads of a recording; stored recordings and library entries fit. */
export type HouseholdRecording = PlanExisting & {
  readonly id: string;
  readonly state: RecordingState;
  readonly padding: Padding;
  readonly ruleId?: RuleId | undefined;
  readonly hiddenAt?: Instant | undefined;
};

/** What one household plan needs, read at one moment. */
export interface HouseholdPlanInput<R extends HouseholdRecording> {
  /** Every rule; disabled ones never match. */
  readonly rules: ReadonlyArray<Rule>;
  /** The guide window planned over. */
  readonly programmes: ReadonlyArray<Programme>;
  /** Every recording, hidden ones included. */
  readonly recordings: ReadonlyArray<R>;
  readonly access: PlanningAccess;
  /** Epoch ms. */
  readonly now: number;
  /** The household time zone. */
  readonly timeZone: string;
}

/** The household plan and what it was decided with. */
export interface HouseholdPlan<R extends HouseholdRecording> {
  readonly planned: Array<PlannedRecording>;
  readonly skipped: Array<SkippedMatch>;
  /** The context the final pass planned with (`unserved` is `moved` when anything moved). */
  readonly context: PlanningContext;
  /** What the sources cannot serve among the active fixed recordings and pass 1's plan. */
  readonly unserved: ReadonlySet<string>;
  /** The unserved items of series recordings whose episode airs again later (pass 2's input). */
  readonly moved: ReadonlySet<string>;
  /** The recordings the plan starts from: all but the derived ones (`isDerived`). */
  readonly existing: ReadonlyArray<R>;
}

/**
 * Whether the plan derives a recording again on every run: scheduled and made by a rule
 * (repeats of damaged recordings included).
 */
export const isDerived = (recording: Pick<HouseholdRecording, "state" | "ruleId">): boolean =>
  recording.state === "scheduled" && recording.ruleId !== undefined;

/**
 * The context planning decides with at `now` (§5.2): history, access and channel names from
 * `access`, and the generic sub-titles of the guide window and of the recordings that ended in
 * the last 30 days.
 */
export const planningContextOf = (
  input: Pick<
    HouseholdPlanInput<HouseholdRecording>,
    "programmes" | "recordings" | "access" | "now" | "timeZone"
  >,
): PlanningContext => ({
  timeZone: input.timeZone,
  now: input.now,
  history: input.access.history,
  sees: input.access.sees,
  seesChannel: input.access.seesChannel,
  channelName: input.access.channelName,
  genericSubtitles: genericSubtitles(
    [
      ...input.programmes,
      ...input.recordings.filter(
        (recording) => epochMs(recording.end) >= input.now - genericLookbackMs,
      ),
    ],
    input.timeZone,
  ),
});

/** The owners of `ruleIds`, once each, in rule order. */
const ownersOf = (rules: ReadonlyArray<Rule>, ruleIds: ReadonlyArray<RuleId>) => [
  ...new Set(ruleIds.flatMap((id) => rules.find((rule) => rule.id === id)?.ownerId ?? [])),
];

/**
 * Plans the household (§5.2) in at most two passes. Pass 1 plans every rule over the guide from
 * the fixed recordings (all but the derived ones). The sources are then asked what they cannot
 * serve among the active fixed recordings (scheduled or running, not hidden) and pass 1's plan.
 * A planned item that cannot be served and whose episode airs again later, on a channel every
 * owner sees, moves: pass 2 plans with those items unserved, so the episode is planned at the
 * later airing instead. An item that cannot be served and does not air again stays planned.
 */
export const planHousehold = <R extends HouseholdRecording>(
  input: HouseholdPlanInput<R>,
): HouseholdPlan<R> => {
  const { rules, programmes, recordings, access } = input;
  const existing = recordings.filter((recording) => !isDerived(recording));
  const base = planningContextOf(input);
  const first = planRecordings(rules, programmes, existing, base);
  const active = existing.filter(
    (recording) => isActive(recording) && recording.hiddenAt === undefined,
  );
  const unserved = access.unserved([
    ...active.map((recording) => ({
      id: recording.id,
      channelId: recording.channelId,
      range: padRange(recording, recording.padding),
    })),
    ...first.planned.map((plan) => ({
      id: plan.programme.id,
      channelId: plan.programme.channelId,
      range: plan.range,
    })),
  ]);
  // Derived recordings are planned again as programmes, so only planned items can move.
  const moved = new Set<string>(
    first.planned.flatMap((plan) =>
      unserved.has(plan.programme.id) &&
      findRepeatAiring(
        {
          ...plan.programme,
          programmeId: plan.programme.id,
          ownerIds: ownersOf(rules, plan.ruleIds),
        },
        programmes,
        { ...base, unserved },
      ) !== undefined
        ? [plan.programme.id]
        : [],
    ),
  );
  if (moved.size === 0) return { ...first, context: base, unserved, moved, existing };
  const context: PlanningContext = { ...base, unserved: moved };
  const second = planRecordings(rules, programmes, existing, context);
  return { ...second, context, unserved, moved, existing };
};

/** What a programme's recording tells the "Record the repeat instead" search. */
export type ConflictRecording = Pick<HouseholdRecording, "id" | "padding" | "ruleId"> & {
  readonly ownerIds: ReadonlyArray<UserId>;
};

/**
 * "Record the repeat instead" for a programme in a schedule conflict (SPEC 8.4): when the
 * household plan cannot serve the programme (its planned item or its recording is unserved),
 * the later airing of the episode the plan's own `findRepeatAiring` picks, with the plan's full
 * context and preferring airings it can serve, for every owner of the recording (the caller
 * when nothing records it yet). Absent without a conflict or a later airing.
 */
export const conflictRepeatAiring = (
  programme: Programme,
  recorded: ConflictRecording | undefined,
  callerId: UserId,
  plan: Pick<HouseholdPlan<HouseholdRecording>, "context" | "unserved"> & {
    readonly programmes: ReadonlyArray<Programme>;
  },
): RepeatAiring | undefined => {
  const inConflict =
    plan.unserved.has(programme.id) || (recorded !== undefined && plan.unserved.has(recorded.id));
  if (!inConflict) return undefined;
  const later = findRepeatAiring(
    {
      ...programme,
      programmeId: programme.id,
      ownerIds: recorded?.ownerIds ?? [callerId],
      ruleId: recorded?.ruleId,
      padding: recorded?.padding,
    },
    plan.programmes,
    { ...plan.context, unserved: plan.unserved },
  );
  return later === undefined
    ? undefined
    : { programmeId: later.id, channelId: later.channelId, start: later.start, end: later.end };
};
