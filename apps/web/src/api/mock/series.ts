import type { RecordingEntry } from "@slipstream/api";
import {
  canCreateCollections,
  canSeeChannel,
  canSeeDestination,
  type Collection,
  type CollectionOffer,
  collectionOffer,
  DAY,
  epochMs,
  type GuideRepeat,
  guideRepeats,
  type HouseholdPlan,
  isHidden,
  planHousehold,
  type PlannedRecording,
  type PlanningAccess,
  type PlanningContext,
  planningContextOf,
  planRecordings,
  type Programme,
  type RecordingId,
  rerunState,
  resolveCollections,
  type Rule,
  type StoredCollection,
  type User,
  type UserId,
} from "@slipstream/domain";
import { type MockData, mockTimeZone } from "./fixtures.ts";
import { accessOf } from "./household.ts";

/*
 * Series recordings in the mock (recording model §3, §5): the same planning context, planner,
 * offer and rerun state the server uses, built from the domain functions over the fixtures.
 */

/** How far ahead the mock plans, like the server's `PLANNING_HORIZON_MILLIS`. */
export const mockPlanningHorizon = 8 * DAY;

/**
 * The household's planning access in the mock: the history, who sees what by the profiles'
 * access, channel names, and as unserved every item of a fixture schedule conflict (an item
 * only planned so far by its recording's programme).
 */
export const mockPlanningAccess = (data: MockData): PlanningAccess => {
  const user = (id: UserId) => data.users.find((candidate) => candidate.id === id);
  return {
    history: data.history,
    channelName: (id) => data.channels.find((channel) => channel.id === id)?.name,
    sees: (ownerId, recording) => {
      const owner = user(ownerId);
      if (owner === undefined) return false;
      const entry = data.recordings.find((candidate) => candidate.id === recording.id);
      return canSeeDestination(accessOf(data, owner), {
        channelId: recording.channelId,
        collectionId: entry?.group.collectionId,
      });
    },
    seesChannel: (ownerId, channelId) => {
      const owner = user(ownerId);
      return owner !== undefined && canSeeChannel(accessOf(data, owner), channelId);
    },
    unserved: (items) => {
      const conflicted = new Set<string>(data.conflicts.flatMap((c) => c.recordingIds));
      return new Set(
        items.flatMap((item) =>
          conflicted.has(item.id) ||
          data.recordings.some((entry) => entry.programmeId === item.id && conflicted.has(entry.id))
            ? [item.id]
            : [],
        ),
      );
    },
  };
};

/** Guide entries from `from` (epoch ms) to the end of the planning horizon, on visible channels. */
const upcoming = (data: MockData, from: number, until = from + mockPlanningHorizon) => {
  const visible = new Set(data.channels.filter((c) => !c.hidden).map((c) => c.id));
  return data.programmes.filter(
    (p) => epochMs(p.end) > from && epochMs(p.start) < until && visible.has(p.channelId),
  );
};

/** The planning context as of `now` (epoch ms), the way the server builds it. */
export const planningContext = (data: MockData, now: number): PlanningContext =>
  planningContextOf({
    programmes: upcoming(data, now),
    recordings: data.recordings,
    access: mockPlanningAccess(data),
    now,
    timeZone: mockTimeZone,
  });

/**
 * What the scheduler would plan now, with every rule: the domain's `planHousehold`, the one
 * planner the server runs, over `programmes` (the planning horizon unless given).
 */
export const currentPlan = (
  data: MockData,
  now: number,
  programmes: ReadonlyArray<Programme> = upcoming(data, now),
): HouseholdPlan<RecordingEntry> =>
  planHousehold({
    rules: data.rules,
    programmes,
    recordings: data.recordings,
    access: mockPlanningAccess(data),
    now,
    timeZone: mockTimeZone,
  });

/** A rule's plan from `now` on, against everything recorded, as `scheduleForRule` and previews see it. */
export const planForRule = (data: MockData, rule: Rule, now: number, until?: number) =>
  planRecordings([rule], upcoming(data, now, until), data.recordings, planningContext(data, now));

/** The guide of the planning horizon from `now`, for answers that need the plan's programmes. */
export const planningWindow = (data: MockData, now: number): Programme[] => upcoming(data, now);

/**
 * A library entry with its repeat chain: what it replaces, and where its own search for a repeat
 * stands (`rerunState`, with the current plan's repeats).
 */
export const withRerun = (
  data: MockData,
  entry: RecordingEntry,
  plan: { readonly planned: ReadonlyArray<PlannedRecording> },
  now: number,
): RecordingEntry => {
  const chain = data.recordings.filter((candidate) => candidate.replacesId === entry.id);
  const planned = plan.planned
    .filter((item) => item.replaces?.includes(entry.id) === true)
    .map((item) => ({ start: item.programme.start, channelId: item.programme.channelId }));
  const rerun = rerunState(entry, chain, planned, now);
  const original =
    entry.replacesId === undefined
      ? undefined
      : data.recordings.find((candidate) => candidate.id === entry.replacesId);
  return {
    ...entry,
    ...(rerun === undefined ? {} : { rerun }),
    ...(original === undefined
      ? {}
      : {
          replaces: {
            recordingId: original.id,
            start: original.start,
            channelId: original.channelId,
          },
        }),
  };
};

/** Whether a library entry is listed: hidden ones (replaced, or kept as a chain's anchor) are not. */
export const listed = (entry: RecordingEntry): boolean => !isHidden(entry);

/**
 * The airings from `from` to `to` (epoch ms) `user` already has, for the guide's repeat mark:
 * `guideRepeats` over the planning window, which counts only copies the user may see.
 */
export const repeatsFor = (
  data: MockData,
  user: User,
  from: number,
  to: number,
  now: number,
): GuideRepeat[] => {
  const programmes = upcoming(data, Math.min(from, now), Math.max(to, now + mockPlanningHorizon));
  const inWindow = new Set<string>(
    programmes.filter((p) => epochMs(p.end) > from && epochMs(p.start) < to).map((p) => p.id),
  );
  const plan = currentPlan(data, now, programmes);
  return guideRepeats(user.id, data.rules, programmes, plan.existing, plan.context).filter(
    (repeat) => inWindow.has(repeat.programmeId),
  );
};

/** The collection offer for a series recording and a caller, when it applies (§3.3). */
export const offerFor = (
  data: MockData,
  rule: Rule,
  user: User,
  now: number,
): CollectionOffer | undefined => {
  if (rule.collectionId !== undefined || rule.offerDeclined || !canCreateCollections(user)) {
    return undefined;
  }
  const recorded = data.recordings.filter((entry) => entry.ruleId === rule.id && listed(entry));
  const { planned, skipped } = planForRule(data, rule, now);
  const matched: Programme[] = [
    ...planned.map((item) => item.programme),
    ...skipped.map((skip) => skip.programme),
  ];
  return matchesOffer(data, [...recorded, ...matched]);
};

/** The offer for a set of recordings and programmes, grouped the way the library would. */
export const matchesOffer = (
  data: MockData,
  items: ReadonlyArray<Programme | RecordingEntry>,
): CollectionOffer | undefined =>
  collectionOffer(
    items.map((item) => ({ ...item, labels: "labels" in item ? item.labels : [] })),
    {
      timeZone: mockTimeZone,
      channelName: (id) => data.channels.find((channel) => channel.id === id)?.name,
      collections: data.collections,
    },
  );

/** A collection as stored: linked ones keep their current matcher as the snapshot. */
const stored = (collection: Collection): StoredCollection => {
  const { matcher, follows, ...rest } = collection;
  return follows === undefined
    ? { ...rest, source: { _tag: "Own", matcher } }
    : { ...rest, source: { _tag: "FollowsRule", ruleId: follows.ruleId, snapshot: matcher } };
};

/**
 * Re-resolves every collection after a rule or collection changed (`resolveCollections`): a
 * linked collection takes its series recording's what conditions, the way the server rewrites
 * the snapshot in the same transaction as the rule save.
 */
export const resolveLinked = (data: MockData): void => {
  data.collections = resolveCollections(data.collections.map(stored), data.rules);
};

/** The recording a repeat replaces, for "Keep the original". */
export const originalOf = (data: MockData, repeatId: RecordingId): RecordingEntry | undefined => {
  const repeat = data.recordings.find((entry) => entry.id === repeatId);
  return repeat?.replacesId === undefined
    ? undefined
    : data.recordings.find((entry) => entry.id === repeat.replacesId);
};
