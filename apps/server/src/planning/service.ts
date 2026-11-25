/**
 * What planning reads beyond rules, guide and recordings (recording model §5.2), in one place so
 * the scheduler, the series recording preview, `GET /guide/repeats` and the programme sheet's
 * record options plan with the same inputs and never disagree:
 *
 * - the episode history (`episode_history`), every owner's;
 * - who may see which recording and channel (the household access policies, `seesRecording`);
 * - which items the sources cannot serve together (`detectConflicts` with the real limits, as
 *   `Recordings.conflicts` does);
 * - channel names.
 *
 * The plan itself is the domain's `planHousehold`, the one the scheduler runs over the same
 * `access`: generic sub-titles, the fixed recordings and both passes are decided there. The plan
 * and each viewer's guide repeats are cached for a minute and dropped on every guide refresh,
 * recording event and `HouseholdChanged` (a profile, its access, a rule, a collection or the
 * settings), so writers only publish what changed.
 */
import { Clock, Context, DateTime, Effect, Layer, Stream } from "effect";
import { InvalidInput } from "@slipstream/api";
import {
  detectConflicts,
  type GuideRepeat,
  guideRepeats,
  type HouseholdPlan,
  type Instant,
  planHousehold,
  planningContextOf,
  type Programme,
  type Recording,
  type User,
  type UserId,
} from "@slipstream/domain";
import type { PlanningAccess, ServiceCandidate } from "@slipstream/recorder";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { episodeHistory, rules } from "../db/schema.ts";
import { EventBus } from "../events.ts";
import { Guide } from "../guide/service.ts";
import { loadRecordingSeer, loadViewer, seesChannel } from "../household/viewer.ts";
import { loadChannelNames, loadRecordings } from "../recordings/store.ts";
import { toRule } from "../rules/store.ts";
import { loadStreamLimits } from "../sources/limits.ts";
import { toHistoryEntry } from "./history.ts";

/** How far ahead rules schedule recordings: eight days, a week of guide plus a margin. */
export const PLANNING_HORIZON_MILLIS = 8 * 86_400_000;

/** How long a plan stays cached without any change (its `now` moves on meanwhile). */
const PLAN_CACHE_MILLIS = 60_000;

/** A guide repeat with the programme it is about. */
interface ViewerRepeat {
  readonly repeat: GuideRepeat;
  readonly programme: Programme;
}

/** Everything one plan needs, read at one moment, and the household plan made from it. */
export interface PlanInputs extends HouseholdPlan<Recording> {
  readonly rules: ReadonlyArray<ReturnType<typeof toRule>>;
  /** The guide of the planning horizon, without pictures. */
  readonly programmes: ReadonlyArray<Programme>;
  /** Every recording, hidden ones included. */
  readonly recordings: ReadonlyArray<Recording>;
}

const makePlanning = Effect.gen(function* () {
  const { read } = yield* Db;
  const config = yield* ServerConfig;
  const guide = yield* Guide;
  const bus = yield* EventBus;

  /** Which items the sources cannot serve together, by id (`detectConflicts`). */
  const unservedOf = Effect.map(
    loadStreamLimits(read),
    (limits) =>
      (items: ReadonlyArray<ServiceCandidate>): ReadonlySet<string> =>
        items.length === 0
          ? new Set()
          : new Set(
              detectConflicts(
                items.map((item) => ({ ...item, kind: "recording" as const })),
                limits.channels,
                limits.sources,
              ).flatMap((conflict) => conflict.demandIds),
            ),
  );

  /**
   * The planning context port of the recorder (`PlanningContextRepo`): history, access, stream
   * limits and channel names, each read once.
   */
  const access = Effect.gen(function* () {
    const history = (yield* read.select().from(episodeHistory).pipe(Effect.orDie)).map(
      toHistoryEntry,
    );
    const seer = yield* loadRecordingSeer(read, config.timeZone);
    const unserved = yield* unservedOf;
    const names = yield* loadChannelNames(read);
    return {
      history,
      sees: seer.sees,
      seesChannel: seer.seesChannel,
      unserved,
      channelName: (channelId) => names.get(channelId),
    } satisfies PlanningAccess;
  });

  /** The guide of the planning horizon and every recording, as the scheduler reads them. */
  const window = (now: number) =>
    Effect.gen(function* () {
      const programmes = yield* guide.airings(now, now + PLANNING_HORIZON_MILLIS);
      const recordings = (yield* loadRecordings(read)).map(({ recording }) => recording);
      return { programmes, recordings };
    });

  /**
   * What episode identity needs at `now`, as the planner sees it (the planning context of
   * `planningContextOf`): for history rows written when a recording is deleted, so they
   * identify the episode the way planning will look for it. Read fresh, never cached.
   */
  const episodeContext = (now: number) =>
    Effect.gen(function* () {
      const { programmes, recordings } = yield* window(now);
      return planningContextOf({
        programmes,
        recordings,
        access: yield* access,
        now,
        timeZone: config.timeZone,
      });
    });

  /** The household plan at `now` (`planHousehold`) with what it was made from. */
  const planAt = (now: number) =>
    Effect.gen(function* () {
      const ruleList = (yield* read.select().from(rules).pipe(Effect.orDie)).map(toRule);
      const { programmes, recordings } = yield* window(now);
      const plan = planHousehold({
        rules: ruleList,
        programmes,
        recordings,
        access: yield* access,
        now,
        timeZone: config.timeZone,
      });
      return { ...plan, rules: ruleList, programmes, recordings } satisfies PlanInputs;
    });

  // The plan, and guide repeats per viewer, until something changes or they are a minute old.
  let cachedPlan: { readonly at: number; readonly inputs: PlanInputs } | undefined;
  const repeatsCache = new Map<
    string,
    { readonly at: number; readonly repeats: ReadonlyArray<ViewerRepeat> }
  >();
  yield* Stream.merge(
    bus.events.pipe(
      Stream.filter(
        (event) =>
          event._tag === "GuideRefreshed" ||
          event._tag === "RecordingChanged" ||
          event._tag === "RecordingRemoved" ||
          event._tag === "RecordingReplaced",
      ),
    ),
    bus.householdChanges,
  ).pipe(
    Stream.runForEach(() =>
      Effect.sync(() => {
        cachedPlan = undefined;
        repeatsCache.clear();
      }),
    ),
    Effect.forkScoped,
  );

  /**
   * The household plan, made at most a minute ago and since nothing changed: every rule over
   * the guide of the planning horizon, every recording, and the context of the final pass.
   */
  const inputs = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (cachedPlan !== undefined && now - cachedPlan.at < PLAN_CACHE_MILLIS) {
      return cachedPlan.inputs;
    }
    const made = yield* planAt(now);
    cachedPlan = { at: now, inputs: made };
    return made;
  });

  /**
   * Every airing of the planning horizon the viewer already has (§3.6), with its programme,
   * cached. `guideRepeats` asks `sees` for the viewer, so `of` is always a copy they may see.
   */
  const repeatsOf = (viewerId: UserId) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const cached = repeatsCache.get(viewerId);
      if (cached !== undefined && now - cached.at < PLAN_CACHE_MILLIS) return cached.repeats;
      const plan = yield* inputs;
      const byId = new Map(plan.programmes.map((programme) => [programme.id, programme]));
      const repeats = guideRepeats(
        viewerId,
        plan.rules,
        plan.programmes,
        plan.existing,
        plan.context,
      ).flatMap((repeat): Array<ViewerRepeat> => {
        const programme = byId.get(repeat.programmeId);
        return programme === undefined ? [] : [{ repeat, programme }];
      });
      repeatsCache.set(viewerId, { at: now, repeats });
      return repeats;
    });

  /** `GET /guide/repeats`: the viewer's repeats among programmes overlapping `[from, to)`. */
  const guideRepeatsFor = (actor: User, from: Instant, to: Instant) =>
    Effect.gen(function* () {
      const fromMs = DateTime.toEpochMillis(from);
      const toMs = DateTime.toEpochMillis(to);
      if (toMs <= fromMs) {
        return yield* new InvalidInput({ problems: [{ path: "to", code: "beforeFrom" }] });
      }
      if (toMs - fromMs > PLANNING_HORIZON_MILLIS) {
        return yield* new InvalidInput({ problems: [{ path: "to", code: "windowTooLong" }] });
      }
      const viewer = yield* loadViewer(read, actor);
      return (yield* repeatsOf(actor.id)).flatMap(({ repeat, programme }) =>
        DateTime.toEpochMillis(programme.start) < toMs &&
        DateTime.toEpochMillis(programme.end) > fromMs &&
        seesChannel(viewer, programme.channelId)
          ? [repeat]
          : [],
      );
    });

  /** Whether the viewer already has this airing (`Owned` or `Repeat` in the record options). */
  const repeatFor = (actor: User, programmeId: string) =>
    Effect.map(
      repeatsOf(actor.id),
      (repeats) => repeats.find(({ repeat }) => repeat.programmeId === programmeId)?.repeat,
    );

  return {
    /** The planning context the recorder plans with (`PlanningContextRepo`). */
    access,
    inputs,
    episodeContext,
    guideRepeats: guideRepeatsFor,
    repeatFor,
  };
});

/** Planning inputs shared by the scheduler, the preview, guide repeats and record options. */
export class Planning extends Context.Service<Planning, Effect.Success<typeof makePlanning>>()(
  "@slipstream/server/Planning",
) {
  static readonly layer = Layer.effect(Planning, makePlanning);
}
