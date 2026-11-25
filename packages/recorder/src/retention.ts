/**
 * Retention (PLAN 6.6, recording model §5.4): which finished recordings to delete under each
 * rule's or collection's policy, which hidden recordings to purge, and which segment files
 * nothing needs any more. Protected recordings are never deleted, nor a chain still looking for
 * its repeat; a segment is deleted only when no remaining recording's range and no live
 * viewer's DVR window covers it.
 */
import { join } from "node:path";
import {
  applyRetention,
  type ChannelId,
  DAY,
  genericLookbackMs,
  genericSubtitles,
  historyEntryFor,
  isAnchor,
  isRecorded,
  needsRepeat,
  type Recording,
  type RecordingId,
  type RerunState,
  rerunState,
  type Retention,
  type Rule,
} from "@slipstream/domain";
import { Clock, Context, DateTime, Effect, Layer } from "effect";
import { CaptureManager, type LiveWindow } from "./capture-manager.ts";
import { RecorderEvents } from "./events.ts";
import {
  HistoryRepo,
  PlanningContextRepo,
  RecordingRepo,
  RuleRepo,
  SegmentRepo,
  Storage,
  type StoredSegment,
} from "./ports.ts";
import { paddedMs, type MsRange } from "./ranges.ts";

/** Recordings that share a retention policy (one rule, or one collection). */
export interface RetentionGroup {
  readonly id: string;
  readonly retention: Retention;
  readonly recordingIds: ReadonlyArray<RecordingId>;
  /**
   * The event a recording belongs to, for "keep the newest N events" (e.g. the collection
   * layout's event part). A recording without one is kept by that policy.
   */
  readonly eventOf?: ((recording: Recording) => string | undefined) | undefined;
}

/** A hidden recording keeps its segments this long, for "Keep the original" (§3.7 step 3). */
export const hiddenRetentionMs = 7 * DAY;

/**
 * Where each recording's chain stands (§3.7): the `rerunState` of the chain's original, for
 * the original and each of its repeats, by recording id. Recordings without a search are absent.
 */
const chainStates = (
  recordings: ReadonlyArray<Recording>,
  nowMs: number,
): Map<RecordingId, RerunState> => {
  const byId = new Map(recordings.map((recording) => [recording.id, recording]));
  const repeats = new Map<RecordingId, Array<Recording>>();
  for (const recording of recordings) {
    if (recording.replacesId === undefined) continue;
    repeats.set(recording.replacesId, [...(repeats.get(recording.replacesId) ?? []), recording]);
  }
  const ofOriginal = new Map<RecordingId, RerunState | undefined>();
  const stateOf = (originalId: RecordingId) => {
    if (!ofOriginal.has(originalId)) {
      const original = byId.get(originalId);
      ofOriginal.set(
        originalId,
        original === undefined
          ? undefined
          : rerunState(original, repeats.get(originalId) ?? [], [], nowMs)?.state,
      );
    }
    return ofOriginal.get(originalId);
  };
  const states = new Map<RecordingId, RerunState>();
  for (const recording of recordings) {
    const state = stateOf(recording.replacesId ?? recording.id);
    if (state !== undefined) states.set(recording.id, state);
  }
  return states;
};

/** The members of a group the domain's `applyRetention` deletes under the group's policy. */
const expiredIn = (
  group: RetentionGroup,
  members: ReadonlyArray<Recording>,
  states: ReadonlyMap<RecordingId, RerunState>,
  nowMs: number,
) => {
  const items = members.map((recording) => ({
    ...recording,
    event: group.eventOf?.(recording),
    rerun: states.get(recording.id),
  }));
  const verdict = applyRetention(group.retention, items, nowMs);
  return verdict.remove.map((entry) => entry.item.id);
};

/**
 * The recordings retention deletes now, by the domain's `applyRetention` (the same verdict the
 * retention preview shows): protected, scheduled and running recordings are never deleted, nor
 * any of a chain still looking for or recording its repeat; a damaged original and its repeats
 * count once, and hidden recordings not at all. One in several groups goes only when every group
 * lets it go, and one in no group is kept.
 */
export const expiredRecordings = (
  recordings: ReadonlyArray<Recording>,
  groups: ReadonlyArray<RetentionGroup>,
  nowMs: number,
): Set<RecordingId> => {
  const byId = new Map(recordings.map((recording) => [recording.id, recording]));
  const states = chainStates(recordings, nowMs);
  const verdicts = new Map<RecordingId, Array<boolean>>();
  for (const group of groups) {
    const members = group.recordingIds.flatMap((id) => byId.get(id) ?? []);
    const expired = new Set(expiredIn(group, members, states, nowMs));
    for (const member of members) {
      verdicts.set(member.id, [...(verdicts.get(member.id) ?? []), expired.has(member.id)]);
    }
  }
  return new Set([...verdicts].flatMap(([id, votes]) => (votes.every(Boolean) ? [id] : [])));
};

/**
 * Hidden recordings whose time is up (§3.7, §5.4): every one 7 days after it was hidden, and an
 * anchor (`hiddenReason: "deleted"`: deleted by a person while its chain looked for a repeat) as
 * soon as its chain ended, replaced, declined or exhausted. A copy a repeat replaced keeps its 7
 * days for "Keep the original".
 */
export const purgedHidden = (
  recordings: ReadonlyArray<Recording>,
  nowMs: number,
): Set<RecordingId> => {
  const states = chainStates(recordings, nowMs);
  const purged = new Set<RecordingId>();
  for (const recording of recordings) {
    if (recording.hiddenAt === undefined || recording.protected) continue;
    if (nowMs - DateTime.toEpochMillis(recording.hiddenAt) >= hiddenRetentionMs) {
      purged.add(recording.id);
      continue;
    }
    const state = states.get(recording.id);
    if (isAnchor(recording) && state !== "looking" && state !== "scheduled") {
      purged.add(recording.id);
    }
  }
  return purged;
};

/**
 * Whether deleting `recording` leaves a history row (§3.6, §5.4): a good finished recording (it
 * needs no repeat) of a series recording set to "Only episodes you don't have yet".
 */
const leavesHistory = (recording: Recording, rules: ReadonlyArray<Rule>) =>
  isRecorded(recording) &&
  !needsRepeat(recording) &&
  rules.some((rule) => rule.id === recording.ruleId && rule.skipRepeats);
/**
 * Segments no remaining recording range and no live DVR window covers. Cancelled recordings and
 * anchors (deleted by a person, the row only holding their chain's search) retain nothing; a
 * copy a repeat replaced keeps its segments while its row lasts, for "Keep the original".
 */
export const unretainedSegments = (
  segments: ReadonlyArray<StoredSegment>,
  recordings: ReadonlyArray<Recording>,
  windows: ReadonlyArray<LiveWindow>,
): Array<StoredSegment> => {
  const retained = new Map<ChannelId, Array<MsRange>>();
  const keep = (channelId: ChannelId, range: MsRange) =>
    retained.set(channelId, [...(retained.get(channelId) ?? []), range]);
  for (const recording of recordings) {
    if (recording.state !== "cancelled" && !isAnchor(recording))
      keep(recording.channelId, paddedMs(recording));
  }
  for (const window of windows) {
    keep(window.channelId, { startMs: window.fromMs, endMs: Number.POSITIVE_INFINITY });
  }
  return segments.filter((segment) => {
    const endMs = segment.startMs + segment.durationMs;
    return !(retained.get(segment.channelId) ?? []).some(
      (range) => range.startMs < endMs && segment.startMs < range.endMs,
    );
  });
};

/** Which retention policies apply to which recordings. */
export class RetentionPolicies extends Context.Service<
  RetentionPolicies,
  {
    groups(recordings: ReadonlyArray<Recording>): Effect.Effect<ReadonlyArray<RetentionGroup>>;
  }
>()("@slipstream/recorder/RetentionPolicies") {
  /**
   * One group per rule, holding the recordings it made. Collections (with their event parts)
   * come from the server, which knows the collection placements.
   */
  static readonly fromRules = Layer.effect(
    RetentionPolicies,
    Effect.gen(function* () {
      const rules = yield* RuleRepo;
      return RetentionPolicies.of({
        groups: (recordings) =>
          Effect.map(rules.list, (all) =>
            all.map((rule) => ({
              id: `rule:${rule.id}`,
              retention: rule.retention,
              recordingIds: recordings
                .filter((recording) => recording.ruleId === rule.id)
                .map((recording) => recording.id),
            })),
          ),
      });
    }),
  );
}

/** What one sweep deleted. */
export interface SweepReport {
  readonly recordingIds: ReadonlyArray<RecordingId>;
  readonly segments: number;
  readonly bytes: number;
}

/** Tuning for the sweeper. */
export interface RetentionSweeperOptions {
  /**
   * Household time zone, for telling generic sub-titles apart (they repeat on local days) in
   * the history rows a sweep writes. Required: history read in another zone than planning
   * would see different days and record an episode the household already had.
   */
  readonly timeZone: string;
}

const makeSweeper = Effect.fnUntraced(function* (options: RetentionSweeperOptions) {
  const repo = yield* RecordingRepo;
  const segments = yield* SegmentRepo;
  const storage = yield* Storage;
  const manager = yield* CaptureManager;
  const policies = yield* RetentionPolicies;
  const rules = yield* RuleRepo;
  const history = yield* HistoryRepo;
  const planning = yield* PlanningContextRepo;
  const bus = yield* RecorderEvents;
  const { timeZone } = options;

  /** The history rows deleting `deleted` leaves, one per owner (§3.6). */
  const historyOf = (
    deleted: ReadonlyArray<Recording>,
    recordings: ReadonlyArray<Recording>,
    now: number,
  ) =>
    Effect.gen(function* () {
      const allRules = yield* rules.list;
      const good = deleted.filter((recording) => leavesHistory(recording, allRules));
      if (good.length === 0) return [];
      const access = yield* planning.context(now);
      const context = {
        timeZone,
        channelName: access.channelName,
        genericSubtitles: genericSubtitles(
          recordings.filter(
            (recording) => DateTime.toEpochMillis(recording.end) >= now - genericLookbackMs,
          ),
          timeZone,
        ),
      };
      return good.flatMap((recording) =>
        recording.ownerIds.map((userId) =>
          historyEntryFor(recording, { userId, ruleId: recording.ruleId }, context),
        ),
      );
    });

  return RetentionSweeper.of({
    sweep: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const recordings = yield* repo.list;
      const expired = expiredRecordings(recordings, yield* policies.groups(recordings), now);
      const entries = yield* historyOf(
        recordings.filter((recording) => expired.has(recording.id)),
        recordings,
        now,
      );
      if (entries.length > 0) yield* history.add(entries);
      const doomedRecordings = new Set([...expired, ...purgedHidden(recordings, now)]);
      yield* Effect.forEach(doomedRecordings, (id) => repo.remove(id), { discard: true });
      const remaining = recordings.filter((recording) => !doomedRecordings.has(recording.id));
      const doomed = unretainedSegments(
        yield* segments.list,
        remaining,
        yield* manager.liveWindows,
      );
      // A file that could not be deleted keeps its index entry, so the next sweep tries again
      // and the disk guard does not count space that never came back.
      const deleted = yield* Effect.filter(doomed, (segment) =>
        storage.removeFile(join(segment.directory, segment.path)).pipe(
          Effect.as(true),
          Effect.catchTag("StorageFailed", (error) =>
            Effect.as(
              Effect.logWarning("Could not delete a segment file; kept for the next sweep").pipe(
                Effect.annotateLogs({ path: error.path, error: error.message }),
              ),
              false,
            ),
          ),
        ),
      );
      yield* segments.remove(deleted);
      const report: SweepReport = {
        recordingIds: [...doomedRecordings],
        segments: deleted.length,
        bytes: deleted.reduce((sum, segment) => sum + segment.bytes, 0),
      };
      if (report.recordingIds.length > 0 || report.segments > 0) {
        yield* bus.publish({ _tag: "RetentionSwept", ...report });
      }
      return report;
    }),
  });
});

/**
 * Deletes expired recordings, purges hidden ones whose time is up, and deletes the segment
 * files nothing needs any more. Deleting a good recording of a series recording that leaves out
 * episodes you have writes history, so it is not recorded again (§3.6).
 */
export class RetentionSweeper extends Context.Service<
  RetentionSweeper,
  { readonly sweep: Effect.Effect<SweepReport> }
>()("@slipstream/recorder/RetentionSweeper") {
  /** The sweeper, reading history days in the household time zone. */
  static readonly layer = (options: RetentionSweeperOptions) =>
    Layer.effect(RetentionSweeper, makeSweeper(options));
}
