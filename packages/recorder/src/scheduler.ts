/**
 * The scheduler turns rules, the guide and one-off requests into running recordings (PLAN 6.6).
 *
 * It keeps the plan current (rules over the guide via `planRecordings`, re-planned when the guide
 * or the rules change and periodically as the horizon moves), takes a capture lease at programme
 * start minus padding and releases it at end plus padding. Recordings that cannot get a stream
 * wait for one, so "start late when a stream frees up" is what happens unless the user picks
 * something else. Stream-limit conflicts are reported by the server's recordings service.
 */
import {
  type CaptureReason,
  type ChannelId,
  epochMs,
  findDuplicate,
  findRepeatAiring,
  gaps,
  isActive,
  isAnchor,
  isDerived,
  isRangedProblem,
  matchRule,
  MINUTE,
  needsRepeat,
  noPadding,
  type Padding,
  planHousehold,
  type PlannedRecording,
  planningContextOf,
  type Programme,
  type ProgrammeId,
  type Recording,
  recordingGapSummary,
  RecordingId,
  type RecordingProblem,
  type RecordingState,
  replacementMinLengthRatio,
  rerunState,
  type RerunState,
  rerunWindowMs,
  type Rule,
  type RuleId,
  summariseGaps,
  type TimeRange,
  totalMillis,
  type UserId,
} from "@slipstream/domain";
import {
  Clock,
  Context,
  DateTime,
  Deferred,
  Effect,
  FiberMap,
  Layer,
  Queue,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { CaptureManager, type ChannelEvent } from "./capture-manager.ts";
import { RecorderEvents } from "./events.ts";
import {
  GuideRepo,
  PlanningContextRepo,
  RecordingRepo,
  RuleRepo,
  SegmentRepo,
  type StoredRecording,
} from "./ports.ts";
import { paddedMs, toTimeRange, withPaddedRange } from "./ranges.ts";

/** Tuning for the scheduler; everything but `timeZone` has a default. */
export interface SchedulerOptions {
  /** Household time zone, for weekday rules. */
  readonly timeZone: string;
  /** How far ahead rules are planned. Default 48 hours. */
  readonly horizonHours?: number;
  /** Re-plan at least this often, as the horizon moves. Default 15 minutes. */
  readonly replanEveryMs?: number;
  /** Keep capturing this long after the end so the last segment lands. Default 8 s. */
  readonly endGraceMs?: number;
  /** Missing stretches up to this long do not make a recording incomplete. Default 15 s. */
  readonly missingToleranceMs?: number;
}

/** No recording with this id. */
export class RecordingNotFound extends Schema.TaggedError<RecordingNotFound>()(
  "RecordingNotFound",
  { recordingId: RecordingId },
) {}

/** The guide has no programme with this id. */
export class ProgrammeNotFound extends Schema.TaggedError<ProgrammeNotFound>()(
  "ProgrammeNotFound",
  { programmeId: Schema.String },
) {}

/** The recording is finished or cancelled, so it cannot be changed this way. */
export class RecordingNotActive extends Schema.TaggedError<RecordingNotActive>()(
  "RecordingNotActive",
  { recordingId: RecordingId, state: Schema.String },
) {}

/** A manual time range to record. */
export interface RangeRequest {
  readonly channelId: ChannelId;
  readonly title: string;
  readonly start: DateTime.Utc;
  readonly end: DateTime.Utc;
  readonly ownerId: UserId;
  readonly padding?: Padding;
}

const at = (millis: number) => DateTime.makeUnsafe(millis);

const newRecording = (
  info: Omit<Programme, "id">,
  fields: {
    readonly programmeId?: ProgrammeId | undefined;
    readonly padding: Padding;
    readonly paddingSource?: Recording["paddingSource"];
    readonly ruleId?: Recording["ruleId"];
    readonly replacesId?: Recording["replacesId"];
    readonly ownerIds: Recording["ownerIds"];
    readonly now: number;
  },
): StoredRecording => ({
  ...info,
  id: RecordingId.make(crypto.randomUUID()),
  ...(fields.programmeId === undefined ? {} : { programmeId: fields.programmeId }),
  padding: fields.padding,
  ...(fields.paddingSource === undefined ? {} : { paddingSource: fields.paddingSource }),
  state: "scheduled",
  problems: [],
  ...(fields.ruleId === undefined ? {} : { ruleId: fields.ruleId }),
  ...(fields.replacesId === undefined ? {} : { replacesId: fields.replacesId }),
  ownerIds: fields.ownerIds,
  declinedBy: [],
  protected: false,
  labels: [],
  exportStatus: "none",
  createdAt: DateTime.makeUnsafe(fields.now),
});

/** The recording problem a capture gap stands for, by why the capture stopped delivering. */
const problemFor = (reason: CaptureReason, range: TimeRange, retries: number): RecordingProblem => {
  switch (reason) {
    case "sourceLimit":
      return { _tag: "SourceLimitReached", range };
    case "sourceUnreachable":
      return { _tag: "SourceUnreachable", range, retries };
    case "streamDropped":
    case "noStream":
    case "noData":
    case "missed":
    case "stopped":
    case "preempted":
    case "diskLow":
      return { _tag: "Gap", range };
  }
};

const problemRange = (problem: RecordingProblem) =>
  problem._tag === "NoData" ? undefined : problem.range;

const startMsOf = (problem: RecordingProblem) => {
  const range = problemRange(problem);
  return range === undefined ? Number.NEGATIVE_INFINITY : DateTime.toEpochMillis(range.start);
};

/**
 * A recording's problems with every `Gap` merged (clipped to `window`, overlapping and touching
 * ones joined) and exact repeats of the others dropped, ordered by start. Gaps arrive from
 * several places (capture events, the final check against the segment store) and are never
 * written twice.
 */
const normaliseProblems = (
  problems: ReadonlyArray<RecordingProblem>,
  window: TimeRange,
): Array<RecordingProblem> => {
  const merged = summariseGaps(
    problems.flatMap((problem) => (problem._tag === "Gap" ? [problem.range] : [])),
    window,
  ).gaps.map((range): RecordingProblem => ({ _tag: "Gap", range }));
  const seen = new Set<string>();
  const others = problems.filter((problem) => {
    if (problem._tag === "Gap") return false;
    const range = problemRange(problem);
    const key =
      range === undefined
        ? problem._tag
        : `${problem._tag}:${DateTime.toEpochMillis(range.start)}-${DateTime.toEpochMillis(range.end)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...others, ...merged].toSorted((a, b) => startMsOf(a) - startMsOf(b));
};

/** The owners of `ruleIds`, once each, in rule order. */
const ownersOf = (allRules: ReadonlyArray<Rule>, ruleIds: ReadonlyArray<RuleId>) => [
  ...new Set(ruleIds.flatMap((id) => allRules.find((rule) => rule.id === id)?.ownerId ?? [])),
];

/**
 * `recording` with the rule `owners` it lacks added at the end, except those who left it; the
 * same value when nothing changes.
 */
const withOwners = (recording: StoredRecording, owners: ReadonlyArray<UserId>): StoredRecording => {
  const missing = owners.filter(
    (owner) => !recording.ownerIds.includes(owner) && !recording.declinedBy.includes(owner),
  );
  return missing.length === 0
    ? recording
    : { ...recording, ownerIds: [...recording.ownerIds, ...missing] };
};

/** `recording` owned by `ownerId`, who asked for it: a decline of theirs ends. */
const withRequester = (recording: StoredRecording, ownerId: UserId): StoredRecording =>
  recording.ownerIds.includes(ownerId)
    ? recording
    : withOwners(
        { ...recording, declinedBy: recording.declinedBy.filter((id) => id !== ownerId) },
        [ownerId],
      );

/** `recording` following the guide's times, and the rule's padding unless a person set its own. */
const followGuide = (
  recording: StoredRecording,
  programme: Programme,
  rulePadding: Padding,
): StoredRecording => ({
  ...recording,
  start: programme.start,
  end: programme.end,
  padding: recording.paddingSource === "user" ? recording.padding : rulePadding,
});

/** `recording` repeating the chain's original `replacesId`, or no repeat when it is undefined. */
const withReplaces = (
  recording: StoredRecording,
  replacesId: RecordingId | undefined,
): StoredRecording => {
  if (recording.replacesId === replacesId) return recording;
  const { replacesId: _previous, ...rest } = recording;
  return replacesId === undefined ? rest : { ...rest, replacesId };
};

const sameShape = (a: StoredRecording, b: StoredRecording) =>
  DateTime.toEpochMillis(a.start) === DateTime.toEpochMillis(b.start) &&
  DateTime.toEpochMillis(a.end) === DateTime.toEpochMillis(b.end) &&
  a.padding.beforeMinutes === b.padding.beforeMinutes &&
  a.padding.afterMinutes === b.padding.afterMinutes &&
  a.ownerIds.length === b.ownerIds.length &&
  a.replacesId === b.replacesId;

/** The padding a plan's range adds around its programme. */
const paddingOf = (plan: PlannedRecording): Padding => ({
  beforeMinutes: Math.round((epochMs(plan.programme.start) - epochMs(plan.range.start)) / MINUTE),
  afterMinutes: Math.round((epochMs(plan.range.end) - epochMs(plan.programme.end)) / MINUTE),
});

/** One airing by channel and start, for finding the recording a planned airing became. */
const airingKey = (channelId: ChannelId, start: DateTime.Utc) => `${channelId}@${epochMs(start)}`;

/** The programme length (start to end, without the extra time). */
const lengthOf = (recording: Pick<Recording, "start" | "end">) =>
  epochMs(recording.end) - epochMs(recording.start);

/** How much of the programme itself a recording misses; all of it when nothing is usable. */
const missingOf = (recording: StoredRecording) =>
  recordingGapSummary(recording).failed
    ? lengthOf(recording)
    : summariseGaps(
        recording.problems.filter(isRangedProblem).map((problem) => problem.range),
        { start: recording.start, end: recording.end },
      ).missingMs;

/**
 * Whether a good repeat replaces the damaged original (§3.7 step 3): its programme at least 90 %
 * of the original's, and fewer missing seconds. Both are measured against the repeat's guide
 * length (`guideLengthMs`, when the guide still has it): a repeat stopped at 92 % misses the
 * other 8 %, although its own range ends where it was stopped.
 */
const replacesOriginal = (
  repeat: StoredRecording,
  original: StoredRecording,
  guideLengthMs: number | undefined,
) => {
  const heldMs = lengthOf(repeat);
  const programmeMs = Math.max(heldMs, guideLengthMs ?? heldMs);
  return (
    programmeMs >= replacementMinLengthRatio * lengthOf(original) &&
    missingOf(repeat) + (programmeMs - heldMs) < missingOf(original)
  );
};

/** Labels of both, once each, the repeat's first. */
const mergedLabels = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => [
  ...new Set([...a, ...b]),
];

/** Schedules and runs recordings. */
export class Scheduler extends Context.Service<
  Scheduler,
  {
    /** Re-plans rules against the guide and acts on anything due, now. */
    readonly replan: Effect.Effect<void>;
    /**
     * Records one guide programme. Recording it again while a recording of it is scheduled or
     * running adds the owner to that one; after it stopped, failed or was cancelled it records
     * anew.
     */
    recordProgramme(
      programmeId: ProgrammeId,
      options: { readonly ownerId: UserId; readonly padding?: Padding },
    ): Effect.Effect<Recording, ProgrammeNotFound>;
    /** Records a manual time range on a channel, deduplicated like `recordProgramme`. */
    recordRange(request: RangeRequest): Effect.Effect<Recording>;
    /** Lengthens a scheduled or running recording ("Extend +30 min"). */
    extend(
      id: RecordingId,
      minutes: number,
    ): Effect.Effect<Recording, RecordingNotFound | RecordingNotActive>;
    /** Cancels a scheduled recording, or ends a running one now (keeping what it has). */
    stop(id: RecordingId): Effect.Effect<Recording, RecordingNotFound | RecordingNotActive>;
    /**
     * Completes once the recording is no longer scheduled or recording: at once for one that
     * ended or is unknown, else when the scheduler has released its capture and settled it
     * (after `stop`, once the last segment landed).
     */
    settled(id: RecordingId): Effect.Effect<void>;
  }
>()("@slipstream/recorder/Scheduler") {
  /** The scheduler, running in the background of the layer's scope. */
  static readonly layer = (options: SchedulerOptions) =>
    Layer.effect(Scheduler, makeScheduler(options));
}

const makeScheduler = Effect.fnUntraced(function* (options: SchedulerOptions) {
  const repo = yield* RecordingRepo;
  const segments = yield* SegmentRepo;
  const guide = yield* GuideRepo;
  const rules = yield* RuleRepo;
  const planning = yield* PlanningContextRepo;
  const manager = yield* CaptureManager;
  const bus = yield* RecorderEvents;

  const horizonMs = (options.horizonHours ?? 48) * 3_600_000;
  const replanEveryMs = options.replanEveryMs ?? 15 * MINUTE;
  const endGraceMs = options.endGraceMs ?? 8000;
  const toleranceMs = options.missingToleranceMs ?? 15_000;

  const running = yield* FiberMap.make<RecordingId>();
  const signal = yield* Queue.dropping<void>(1);
  const tickLock = yield* Semaphore.make(1);
  let dirty = true;
  /**
   * Marks the plan stale and wakes the loop, which re-plans on its next tick. Never takes the
   * tick lock, so code running under it (finishing a recording) may call it.
   */
  const replanSoon = Effect.sync(() => {
    dirty = true;
  }).pipe(Effect.andThen(Queue.offer(signal, undefined)), Effect.asVoid);
  let lastPlanMs = Number.NEGATIVE_INFINITY;
  const stoppedByUser = new Set<RecordingId>();
  /** Who waits for a recording to settle (`settled`); `end` lets them go. */
  const settling = new Map<RecordingId, Set<Deferred.Deferred<void>>>();
  /** Why a recording's capture last had to wait for a stream. */
  const waitReasons = new Map<RecordingId, CaptureReason>();

  /**
   * Rules over the guide, reconciled with the derived recordings: scheduled ones with a rule,
   * repeats of damaged recordings included, re-derived on every run so planning is idempotent.
   * The plan itself is the domain's `planHousehold` (two passes, §5.2), the one the server's
   * previews and the web mock run too. A derived recording always follows the guide's times;
   * its padding follows the rule until someone set it on the recording (`paddingSource:
   * "user"`). Every owner of a rule that wants a programme owns its recording, also one somebody
   * recorded by hand, unless they left it; a series recording that leaves an airing out as a
   * repeat adds its owner to the copy (§5.3). A repeat of several damaged originals belongs to
   * all their owners.
   */
  const planRules = (now: number) =>
    Effect.gen(function* () {
      const allRules = yield* rules.list;
      const programmes = yield* guide.programmes({ start: at(now), end: at(now + horizonMs) });
      const recordings = yield* repo.list;
      const derived = recordings.filter(isDerived);
      const access = yield* planning.context(now);
      const {
        planned,
        skipped,
        existing: fixed,
      } = planHousehold({
        rules: allRules,
        programmes,
        recordings,
        access,
        now,
        timeZone: options.timeZone,
      });

      const byId = new Map(recordings.map((recording) => [recording.id, recording]));
      const kept = new Set<RecordingId>();
      /** The recording each planned airing became, for owners added to a planned copy. */
      const recordingOfAiring = new Map<string, RecordingId>();
      for (const plan of planned) {
        const { programme } = plan;
        const padding = paddingOf(plan);
        const originals = (plan.replaces ?? []).flatMap((id) => byId.get(id) ?? []);
        // The chain the stored repeat joins: its first original's (`replacesId`).
        const replacesId = plan.replaces?.[0];
        const owners = [
          ...new Set([
            ...ownersOf(allRules, plan.ruleIds),
            ...originals.flatMap((original) =>
              original.ownerIds.filter((owner) => !original.declinedBy.includes(owner)),
            ),
          ]),
        ];
        const key = airingKey(programme.channelId, programme.start);
        const match = findDuplicate({ ...programme, programmeId: programme.id }, derived);
        if (match !== undefined) {
          kept.add(match.id);
          recordingOfAiring.set(key, match.id);
          // The guide moved the programme: follow its times, keep the snapshot's names.
          const reshaped = (recording: StoredRecording) =>
            withReplaces(
              withOwners(followGuide(recording, programme, padding), owners),
              replacesId,
            );
          if (!sameShape(match, reshaped(match))) yield* repo.update(match.id, reshaped);
          continue;
        }
        const [firstOwner, ...otherOwners] = owners;
        if (firstOwner === undefined) continue;
        const { id: programmeId, ...info } = programme;
        const inserted = newRecording(info, {
          programmeId,
          padding,
          paddingSource: "rule",
          ruleId: plan.ruleIds[0],
          replacesId,
          ownerIds: [firstOwner, ...otherOwners],
          now,
        });
        yield* repo.insert(inserted);
        recordingOfAiring.set(key, inserted.id);
      }

      // A rule that left an airing out because its owner has it (the same airing recorded
      // already, or the episode as a repeat) adds its owner to that copy; `addOwners` skips
      // owners it has and those who left it.
      const active = fixed.filter(isActive);
      for (const skip of skipped) {
        const { programme, reason } = skip;
        if (reason._tag === "SameAiring") {
          const existing = findDuplicate({ ...programme, programmeId: programme.id }, active);
          if (existing === undefined) continue;
          for (const rule of allRules) {
            if (matchRule(rule, programme, options.timeZone) !== undefined) {
              yield* repo.addOwners(existing.id, [rule.ownerId], rule.id);
            }
          }
        } else if (reason._tag === "Repeat" && reason.of.state !== "history") {
          const rule = allRules.find((candidate) => candidate.id === skip.ruleId);
          const id =
            reason.of.recordingId ??
            recordingOfAiring.get(airingKey(reason.of.channelId, reason.of.start));
          if (rule !== undefined && id !== undefined)
            yield* repo.addOwners(id, [rule.ownerId], rule.id);
        }
      }
      for (const recording of derived) {
        if (kept.has(recording.id)) continue;
        // No rule wants it any more, it is a repeat now, or its programme left the guide.
        if (paddedMs(recording).startMs > now) yield* repo.remove(recording.id);
      }
    });

  const addProblem = (id: RecordingId, problem: RecordingProblem) =>
    repo.update(id, (recording) => ({
      ...recording,
      problems: normaliseProblems(
        [...recording.problems, problem],
        toTimeRange(paddedMs(recording)),
      ),
    }));

  /** Turns what a recording's lease hears into problems and events. */
  const onChannelEvent = (id: RecordingId, event: ChannelEvent) =>
    Effect.gen(function* () {
      if (event._tag === "StateChanged" && event.state === "failed" && event.reason) {
        waitReasons.set(id, event.reason);
        return;
      }
      if (event._tag !== "Gap") return;
      const recording = yield* repo.get(id);
      if (recording === undefined) return;
      const range = paddedMs(recording);
      const fromMs = Math.max(event.fromMs, range.startMs);
      const toMs = Math.min(event.toMs, range.endMs);
      if (fromMs >= toMs) return;
      const gap = toTimeRange({ startMs: fromMs, endMs: toMs });
      yield* addProblem(id, problemFor(event.reason, gap, event.retries));
      yield* bus.publish({
        _tag: "RecordingGap",
        recordingId: id,
        range: gap,
        reason: event.reason,
      });
    });

  const capture = (id: RecordingId, channelId: ChannelId) =>
    Effect.scoped(
      Effect.gen(function* () {
        const lease = yield* manager.acquire(channelId, { id, kind: "recording" }, { wait: true });
        yield* Stream.runForEach(lease.events, (event) => onChannelEvent(id, event));
      }),
    ).pipe(Effect.orDie);

  const start = (recording: StoredRecording, now: number) =>
    Effect.gen(function* () {
      if (recording.state === "scheduled") {
        yield* repo.update(recording.id, (current) => ({ ...current, state: "recording" }));
        yield* bus.publish({
          _tag: "RecordingStarted",
          recordingId: recording.id,
          channelId: recording.channelId,
          at: at(now),
        });
      }
      yield* FiberMap.run(running, recording.id, capture(recording.id, recording.channelId), {
        onlyIfMissing: true,
      });
    });

  /** Where `original`'s search for a repeat stands, by the stored chain (§3.7). */
  const chainState = (original: StoredRecording, now: number) =>
    Effect.map(
      repo.list,
      (all): RerunState | undefined =>
        rerunState(
          original,
          all.filter((recording) => recording.replacesId === original.id),
          [],
          now,
        )?.state,
    );

  /**
   * The originals a repeat repeats (§3.7): its chain's (`replacesId`) and every other damaged
   * original of the episode still looking whose repeat search picks this very airing, as the
   * planner shared one repeat between them (`PlannedRecording.replaces`). Only the first is
   * stored on the repeat, so the others are found again the way the planner found them.
   */
  const originalsOf = (repeat: StoredRecording, now: number) =>
    Effect.gen(function* () {
      if (repeat.replacesId === undefined) return [];
      const all = yield* repo.list;
      const primary = all.find((recording) => recording.id === repeat.replacesId);
      if (primary === undefined) return [];
      const candidates = all.filter(
        (recording) =>
          recording.id !== primary.id &&
          recording.id !== repeat.id &&
          recording.replacesId === undefined &&
          recording.ruleId !== undefined &&
          rerunState(
            recording,
            all.filter((member) => member.replacesId === recording.id),
            [],
            now,
          )?.state === "looking",
      );
      if (candidates.length === 0) return [primary];
      const access = yield* planning.context(now);
      const programmes = yield* guide.programmes({ start: at(now), end: at(now + horizonMs) });
      const context = planningContextOf({
        programmes,
        recordings: all,
        access,
        now,
        timeZone: options.timeZone,
      });
      const { programmeId, ...info } = repeat;
      const airing = { ...info, id: programmeId ?? repeat.id };
      return [
        primary,
        ...candidates.filter(
          (candidate) => findRepeatAiring(candidate, [airing], context) !== undefined,
        ),
      ];
    });

  /**
   * A good repeat replaces damaged originals and every earlier damaged repeat of their chains
   * (§3.7 step 3): they get `replacedById`, `hiddenAt` and `hiddenReason: "replaced"`, and the
   * repeat takes over their owners, labels and pinned collection. A copy a person deleted while
   * its chain looked (an anchor, `hiddenReason: "deleted"`) stays deleted and gets no
   * `replacedById`, so it can never be kept. A protected original is never hidden: it is kept
   * beside the repeat.
   */
  const replace = (
    repeat: StoredRecording,
    originals: ReadonlyArray<StoredRecording>,
    now: number,
  ) =>
    Effect.gen(function* () {
      const chains = new Set(originals.map((original) => original.id));
      const earlier = (yield* repo.list).filter(
        (recording) =>
          recording.replacesId !== undefined &&
          chains.has(recording.replacesId) &&
          recording.id !== repeat.id &&
          recording.replacedById === undefined &&
          !recording.protected &&
          (recording.state === "failed" ||
            recording.state === "incomplete" ||
            recording.state === "completed") &&
          needsRepeat(recording),
      );
      const unprotected = originals.filter((original) => !original.protected);
      const resolved = [...unprotected, ...earlier];
      const replacedIds: Array<RecordingId> = [];
      for (const damaged of resolved) {
        const updated = yield* repo.update(damaged.id, (current) =>
          isAnchor(current)
            ? current
            : {
                ...current,
                replacedById: repeat.id,
                hiddenAt: current.hiddenAt ?? at(now),
                hiddenReason: "replaced",
              },
        );
        if (updated?.replacedById === repeat.id) replacedIds.push(damaged.id);
      }
      yield* repo.update(repeat.id, (current) => {
        const owners = resolved
          .flatMap((damaged) => damaged.ownerIds)
          .filter((owner) => !current.declinedBy.includes(owner));
        const pinned =
          current.pinnedCollectionId ??
          unprotected.find((original) => original.pinnedCollectionId !== undefined)
            ?.pinnedCollectionId;
        return {
          ...withOwners(current, owners),
          labels: mergedLabels(
            current.labels,
            resolved.flatMap((damaged) => damaged.labels),
          ),
          ...(pinned === undefined ? {} : { pinnedCollectionId: pinned }),
        };
      });
      for (const original of originals) {
        if (original.protected) {
          yield* repo.update(original.id, (current) => ({ ...current, rerunOutcome: "kept" }));
        }
      }
      for (const original of unprotected) {
        if (replacedIds.includes(original.id)) {
          yield* bus.publish({ _tag: "RecordingReplaced", id: repeat.id, replacedId: original.id });
        }
      }
    });

  /** The guide length of a recording's programme, when the guide still lists it. */
  const guideLengthOf = (recording: StoredRecording) =>
    recording.programmeId === undefined
      ? Effect.succeed(undefined)
      : Effect.map(guide.programme(recording.programmeId), (programme) =>
          programme === undefined ? undefined : lengthOf(programme),
        );

  /**
   * What ending means for the search for a repeat (§3.7). A series recording's recording that
   * needs a repeat starts looking until its programme end plus 14 days. A repeat that ends good
   * replaces each of its originals when it is at least 90 % as long and misses less, else both
   * are kept; a repeat a person stopped never replaces anything. A repeat that needs a repeat
   * itself counts as a failed attempt for each original. Either way the planner runs again
   * soon, without taking the tick lock this runs under. Returns where the chain stands.
   */
  const concludeRerun = (ended: StoredRecording, now: number, stopped: boolean) =>
    Effect.gen(function* () {
      const damaged = needsRepeat(ended);
      if (ended.replacesId === undefined) {
        if (!damaged || ended.ruleId === undefined) return undefined;
        const looking = yield* repo.update(ended.id, (current) =>
          current.rerunUntil === undefined
            ? { ...current, rerunUntil: at(epochMs(current.end) + rerunWindowMs) }
            : current,
        );
        yield* replanSoon;
        return looking === undefined ? undefined : yield* chainState(looking, now);
      }
      const open = (yield* originalsOf(ended, now)).filter(
        (original) => original.replacedById === undefined && original.rerunOutcome === undefined,
      );
      if (open.length > 0) {
        const keep = (original: StoredRecording) =>
          repo.update(original.id, (current) => ({ ...current, rerunOutcome: "kept" }));
        if (damaged) {
          for (const original of open) {
            yield* repo.update(original.id, (current) => ({
              ...current,
              rerunAttempts: (current.rerunAttempts ?? 0) + 1,
            }));
          }
        } else if (stopped) {
          for (const original of open) yield* keep(original);
        } else {
          const guideLengthMs = yield* guideLengthOf(ended);
          const replaced = open.filter((original) =>
            replacesOriginal(ended, original, guideLengthMs),
          );
          if (replaced.length > 0) yield* replace(ended, replaced, now);
          for (const original of open) {
            if (!replaced.includes(original)) yield* keep(original);
          }
        }
        yield* replanSoon;
      }
      const latest = yield* repo.get(ended.replacesId);
      return latest === undefined ? undefined : yield* chainState(latest, now);
    });

  /**
   * "Skip this one" on a planned repeat: the chains of all its originals stop looking for good
   * (§3.7 step 7).
   */
  const declineRerun = (repeat: StoredRecording, now: number) =>
    Effect.gen(function* () {
      for (const original of yield* originalsOf(repeat, now)) {
        yield* repo.update(original.id, (current) =>
          current.replacedById === undefined && current.rerunOutcome === undefined
            ? { ...current, rerunOutcome: "declined" }
            : current,
        );
      }
      yield* replanSoon;
    });

  const end = (
    id: RecordingId,
    state: RecordingState,
    now: number,
    problems: ReadonlyArray<RecordingProblem>,
    reason: CaptureReason | undefined,
  ) =>
    Effect.gen(function* () {
      const ended = yield* repo.update(id, (recording) => ({
        ...recording,
        state,
        problems: normaliseProblems(problems, toTimeRange(paddedMs(recording))),
      }));
      const waiting = settling.get(id);
      settling.delete(id);
      for (const deferred of waiting ?? []) yield* Deferred.succeed(deferred, undefined);
      let rerun: RerunState | undefined;
      if (ended !== undefined && state === "cancelled") {
        if (ended.replacesId !== undefined) yield* declineRerun(ended, now);
      } else if (ended !== undefined) {
        rerun = yield* concludeRerun(ended, now, reason === "stopped");
      }
      if (state === "failed" && reason !== undefined) {
        yield* bus.publish({ _tag: "RecordingFailed", recordingId: id, reason, at: at(now) });
      }
      yield* bus.publish({
        _tag: "RecordingEnded",
        recordingId: id,
        state,
        at: at(now),
        ...(reason === undefined ? {} : { reason }),
        ...(rerun === undefined ? {} : { rerun }),
      });
    });

  /** Releases the lease and judges what the segment store holds for the recording's range. */
  const finish = (recording: StoredRecording, now: number) =>
    Effect.gen(function* () {
      yield* FiberMap.remove(running, recording.id);
      const current = (yield* repo.get(recording.id)) ?? recording;
      const range = paddedMs(current);
      const held = yield* segments.forChannel(current.channelId, range.startMs, range.endMs);
      const covered = held.map((segment) => ({
        start: at(segment.startMs),
        end: at(segment.startMs + segment.durationMs),
      }));
      const stopped = stoppedByUser.delete(current.id);
      const reason: CaptureReason | undefined = stopped ? "stopped" : undefined;
      // Why the capture had nothing when no gap event said so: it never got a stream.
      const waitReason = waitReasons.get(current.id);
      waitReasons.delete(current.id);
      const window = toTimeRange(range);
      const known = current.problems.flatMap((problem) => problemRange(problem) ?? []);
      const missing = gaps(window, covered).filter((gap) => totalMillis([gap]) > toleranceMs);
      if (totalMillis(covered) === 0) {
        yield* end(
          current.id,
          "failed",
          now,
          [
            ...current.problems,
            waitReason === undefined ? { _tag: "NoData" } : problemFor(waitReason, window, 0),
          ],
          waitReason ?? "noData",
        );
        return;
      }
      const unexplained = missing.flatMap((gap) =>
        gaps(gap, known).filter((part) => totalMillis([part]) > toleranceMs),
      );
      const problems: Array<RecordingProblem> = [
        ...current.problems,
        ...unexplained.map((gap) => problemFor(waitReason ?? "streamDropped", gap, 0)),
      ];
      // What went missing (reported or found) spans the whole window: nothing worth keeping.
      if (summariseGaps([...known, ...missing], window).coversWindow) {
        yield* end(current.id, "failed", now, problems, waitReason ?? "noData");
        return;
      }
      yield* end(
        current.id,
        missing.length > 0 ? "incomplete" : "completed",
        now,
        problems,
        reason,
      );
    });

  const missed = (recording: StoredRecording, now: number) =>
    end(recording.id, "failed", now, [...recording.problems, { _tag: "NoData" }], "missed");

  /** Acts on everything due and returns when to look again. */
  const tick = tickLock.withPermit(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (dirty || now - lastPlanMs >= replanEveryMs) {
        dirty = false;
        lastPlanMs = now;
        yield* planRules(now);
      }
      for (const recording of yield* repo.list) {
        const range = paddedMs(recording);
        if (recording.state === "scheduled") {
          if (now >= range.endMs) yield* missed(recording, now);
          else if (now >= range.startMs) yield* start(recording, now);
        } else if (recording.state === "recording") {
          if (now >= range.endMs + endGraceMs) yield* finish(recording, now);
          else yield* start(recording, now);
        }
      }
      const upcoming = (yield* repo.list).flatMap((recording) => {
        const range = paddedMs(recording);
        if (recording.state === "scheduled") return [range.startMs];
        if (recording.state === "recording") return [range.endMs + endGraceMs];
        return [];
      });
      return Math.min(lastPlanMs + replanEveryMs, ...upcoming.filter((time) => time > now));
    }),
  );

  const nudge = Queue.offer(signal, undefined).pipe(Effect.asVoid);
  const actNow = tick.pipe(Effect.andThen(nudge));

  const watch = (changes: Stream.Stream<void>) =>
    Stream.runForEach(changes, () => replanSoon).pipe(Effect.forkScoped);
  yield* watch(guide.changes);
  yield* watch(rules.changes);

  yield* Effect.gen(function* () {
    while (true) {
      const next = yield* tick;
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.raceFirst(Effect.sleep(Math.max(1, next - now)), Queue.take(signal));
    }
  }).pipe(Effect.forkScoped);

  const getActive = (id: RecordingId) =>
    Effect.gen(function* () {
      const recording = yield* repo.get(id);
      if (recording === undefined) return yield* new RecordingNotFound({ recordingId: id });
      if (!isActive(recording)) {
        return yield* new RecordingNotActive({ recordingId: id, state: recording.state });
      }
      return recording;
    });

  const reshape = (id: RecordingId, f: (recording: StoredRecording) => StoredRecording) =>
    Effect.gen(function* () {
      yield* getActive(id);
      const updated = yield* repo.update(id, f);
      yield* actNow;
      return updated ?? (yield* new RecordingNotFound({ recordingId: id }));
    });

  /** Ends a scheduled (or waiting) recording without keeping anything, releasing its lease. */
  const cancel = (id: RecordingId, reason: CaptureReason) =>
    Effect.gen(function* () {
      const recording = yield* getActive(id);
      const now = yield* Clock.currentTimeMillis;
      // A recording waiting for a stream already holds a place in the manager's queue.
      yield* FiberMap.remove(running, id);
      waitReasons.delete(id);
      stoppedByUser.delete(id);
      yield* end(recording.id, "cancelled", now, recording.problems, reason);
      yield* actNow;
      return (yield* repo.get(id)) ?? recording;
    });

  const settled = (id: RecordingId) =>
    Effect.flatMap(Deferred.make<void>(), (done) =>
      Effect.gen(function* () {
        const waiting = settling.get(id) ?? new Set();
        waiting.add(done);
        settling.set(id, waiting);
        // Waiting before looking: an `end` in between finds the waiter and lets it go.
        const recording = yield* repo.get(id);
        if (recording !== undefined && isActive(recording)) yield* Deferred.await(done);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            const waiting = settling.get(id);
            waiting?.delete(done);
            if (waiting?.size === 0) settling.delete(id);
          }),
        ),
      ),
    );

  const addOwner = (recording: StoredRecording, ownerId: UserId) =>
    recording.ownerIds.includes(ownerId)
      ? Effect.succeed(recording)
      : repo
          .update(recording.id, (current) => withRequester(current, ownerId))
          .pipe(Effect.map((updated) => updated ?? recording));

  /**
   * Adds `ownerId` to a scheduled or running recording of the same airing, or inserts `fresh`
   * when there is none. Finished, failed and cancelled recordings never absorb a new request,
   * so recording again after a stop or a failure records anew. Runs under the tick lock, so two
   * requests (or a request and a rule pass) cannot both miss each other and insert twice.
   */
  const recordOnce = (
    duplicateIn: (active: ReadonlyArray<StoredRecording>) => StoredRecording | undefined,
    ownerId: UserId,
    fresh: (now: number) => StoredRecording,
  ) =>
    Effect.gen(function* () {
      const decided = yield* tickLock.withPermit(
        Effect.gen(function* () {
          const active = (yield* repo.list).filter(isActive);
          const duplicate = duplicateIn(active);
          if (duplicate !== undefined) {
            return { recording: yield* addOwner(duplicate, ownerId), inserted: false };
          }
          const recording = fresh(yield* Clock.currentTimeMillis);
          yield* repo.insert(recording);
          return { recording, inserted: true };
        }),
      );
      // The tick takes the lock itself, so it runs once the decision is stored.
      if (decided.inserted) yield* actNow;
      return decided.recording;
    });

  return Scheduler.of({
    replan: Effect.sync(() => {
      dirty = true;
    }).pipe(Effect.andThen(actNow)),
    recordProgramme: (programmeId, request) =>
      Effect.gen(function* () {
        const programme = yield* guide.programme(programmeId);
        if (programme === undefined) return yield* new ProgrammeNotFound({ programmeId });
        const { id: _id, ...info } = programme;
        return yield* recordOnce(
          (active) => findDuplicate({ ...info, programmeId }, active),
          request.ownerId,
          (now) =>
            newRecording(info, {
              programmeId,
              padding: request.padding ?? noPadding,
              ownerIds: [request.ownerId],
              now,
            }),
        );
      }),
    recordRange: (request) => {
      const info: Omit<Programme, "id"> = {
        channelId: request.channelId,
        start: request.start,
        end: request.end,
        title: request.title,
        categories: [],
        repeat: false,
        live: false,
      };
      const padding = request.padding ?? noPadding;
      const wanted = paddedMs({ start: request.start, end: request.end, padding });
      // A manual range is no guide entry: it repeats only the same range on the same channel,
      // never another range that carries the same title.
      const sameRange = (active: ReadonlyArray<StoredRecording>) =>
        active.find((recording) => {
          const range = paddedMs(recording);
          return (
            recording.channelId === request.channelId &&
            range.startMs === wanted.startMs &&
            range.endMs === wanted.endMs
          );
        });
      return recordOnce(sameRange, request.ownerId, (now) =>
        newRecording(info, { padding, ownerIds: [request.ownerId], now }),
      );
    },
    extend: (id, minutes) =>
      reshape(id, (recording) => {
        const range = paddedMs(recording);
        return {
          ...withPaddedRange(recording, {
            startMs: range.startMs,
            endMs: range.endMs + Math.max(0, minutes) * MINUTE,
          }),
          // A person set this extra time: re-planning the rule keeps it.
          paddingSource: "user",
        };
      }),
    stop: (id) =>
      Effect.gen(function* () {
        const recording = yield* getActive(id);
        if (recording.state === "scheduled") return yield* cancel(id, "stopped");
        const now = yield* Clock.currentTimeMillis;
        // Still waiting for a stream (or for its first segment): there is nothing to keep.
        const held = yield* segments.forChannel(
          recording.channelId,
          paddedMs(recording).startMs,
          now,
        );
        if (held.length === 0) return yield* cancel(id, "stopped");
        stoppedByUser.add(id);
        return yield* reshape(id, (current) => {
          const range = paddedMs(current);
          return withPaddedRange(current, {
            startMs: range.startMs,
            endMs: Math.max(range.startMs, Math.min(now, range.endMs)),
          });
        });
      }),
    settled,
  });
});
