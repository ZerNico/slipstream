/**
 * One planner (recording model §5.2): the scheduler's path (its ports `RuleRepo`, `GuideRepo`,
 * `RecordingRepo` and `PlanningContextRepo` into `planHousehold`, as `Scheduler.planRules`
 * reads them) and `Planning.inputs` (what the preview, guide repeats and record options plan
 * with) agree on what is planned and what is left out, over a household with a stream limit
 * that cannot serve everything, an unserved item that does not air again, an episode that moves
 * to its later airing and a hidden scheduled row.
 */
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { planHousehold } from "@slipstream/domain";
import { GuideRepo, PlanningContextRepo, RecordingRepo, RuleRepo } from "@slipstream/recorder";
import { ServerConfig } from "../src/config.ts";
import { Db } from "../src/db/client.ts";
import {
  channels,
  channelStreams,
  programmes,
  recordingOwners,
  recordings,
  rules,
  sources,
  sourceStreams,
  users,
} from "../src/db/schema.ts";
import { EventBus } from "../src/events.ts";
import { Guide } from "../src/guide/service.ts";
import { Planning, PLANNING_HORIZON_MILLIS } from "../src/planning/service.ts";
import {
  GuideRepoLive,
  PlanningContextRepoLive,
  RecordingRepoLive,
  RuleRepoLive,
} from "../src/recorder/repos.ts";
import { tempDir, testSettings } from "./support.ts";

const HOUR = 3_600_000;
const timeZone = "Europe/Berlin";

/** The server's planning services and the scheduler's ports over one database in `root`. */
const servicesIn = (root: string) => {
  const base = Layer.mergeAll(Db.layer, EventBus.layer).pipe(
    Layer.provideMerge(ServerConfig.layerWith(testSettings(root, { timeZone }))),
  );
  const planning = Planning.layer.pipe(
    Layer.provideMerge(Guide.layer.pipe(Layer.provideMerge(base))),
  );
  return Layer.mergeAll(
    PlanningContextRepoLive,
    GuideRepoLive,
    RuleRepoLive,
    RecordingRepoLive,
  ).pipe(Layer.provideMerge(planning));
};

/** A series recording's conditions: this exact title on any channel. */
const matcher = (title: string) => ({
  channels: [],
  title: [{ _tag: "IsExactly" as const, values: [title] as [string] }],
  categories: [],
  weekdays: [],
});

/**
 * One source with one stream for three channels: Der Alte takes it, Tatort airs again later,
 * Polizeiruf does not.
 */
const seed = (now: number) =>
  Effect.gen(function* () {
    const { write } = yield* Db;
    yield* write.insert(users).values({
      id: "kim",
      username: "kim",
      displayName: "Kim",
      role: "admin",
      passwordHash: "!",
      createdAt: 0,
    });
    yield* write.insert(sources).values({
      id: "s1",
      name: "tvproxy",
      config: JSON.stringify({ _tag: "M3u", playlistUrl: "http://example.test/p.m3u" }),
      refreshIntervalMinutes: 60,
      maxStreams: 1,
      headers: {},
      guideCleanup: { removeDuplicates: true, rewrites: [] },
      enabled: true,
      health: "unknown",
    });
    for (const [id, name] of [
      ["erste", "Das Erste"],
      ["zdf", "ZDF"],
      ["one", "ONE"],
    ] as const) {
      yield* write
        .insert(channels)
        .values({ id, name, guideChannelId: `${id}.de`, favourite: false, hidden: false });
      yield* write.insert(sourceStreams).values({
        id: `stream-${id}`,
        sourceId: "s1",
        upstreamId: id,
        name,
        url: `http://example.test/${id}.ts`,
        lastSeenAt: 0,
      });
      yield* write
        .insert(channelStreams)
        .values({ id: `link-${id}`, channelId: id, sourceStreamId: `stream-${id}`, priority: 0 });
    }
    const airing = (
      id: string,
      channel: string,
      fromHours: number,
      toHours: number,
      fields: Partial<typeof programmes.$inferInsert>,
    ) => ({
      id,
      sourceId: "s1",
      guideChannelId: `${channel}.de`,
      start: now + fromHours * HOUR,
      end: now + toHours * HOUR,
      title: "",
      categories: ["Krimi"],
      repeat: false,
      live: false,
      ...fields,
    });
    const tatort = {
      title: "Tatort",
      subtitle: "Unter Wölfen",
      episode: { episode: 1247 },
    };
    yield* write.insert(programmes).values([
      // Der Alte comes first and takes the one stream.
      airing("alte-zdf", "zdf", 0.5, 2, { title: "Der Alte", subtitle: "Kalt" }),
      airing("tatort-erste", "erste", 1, 2.5, tatort),
      // The same episode later on ONE: Tatort moves here when Das Erste cannot be served.
      airing("tatort-one", "one", 26, 27.5, tatort),
      // Polizeiruf airs once and cannot be served either: it stays planned.
      airing("polizeiruf-one", "one", 1.5, 2.2, { title: "Polizeiruf 110", subtitle: "Kalt" }),
    ]);
    yield* write.insert(rules).values(
      ["Tatort", "Der Alte", "Polizeiruf 110"].map((title) => ({
        id: `rule-${title}`,
        name: title,
        enabled: true,
        ownerId: "kim",
        matcher: matcher(title),
        paddingBeforeMinutes: 0,
        paddingAfterMinutes: 0,
        retention: { _tag: "KeepAll" as const },
        createdAt: 0,
        skipRepeats: true,
      })),
    );
    // A hidden scheduled row on ZDF at the same time: it takes no stream.
    yield* write.insert(recordings).values({
      id: "hidden",
      channelId: "zdf",
      start: now + HOUR,
      end: now + 2 * HOUR,
      title: "Hidden",
      categories: [],
      repeat: false,
      live: false,
      paddingBeforeMinutes: 0,
      paddingAfterMinutes: 0,
      state: "scheduled",
      problems: [],
      protected: false,
      exportStatus: "none",
      createdAt: 0,
      hiddenAt: now - HOUR,
      hiddenReason: "deleted",
    });
    yield* write
      .insert(recordingOwners)
      .values({ recordingId: "hidden", userId: "kim", addedAt: 0, addedByRuleId: null });
  });

describe("planning parity", () => {
  it.effect("plans the same through the scheduler's ports and Planning.inputs", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const now = Math.floor(Date.now() / HOUR) * HOUR;
      yield* Effect.gen(function* () {
        yield* seed(now);
        const access = yield* (yield* PlanningContextRepo).context(now);
        const scheduler = planHousehold({
          rules: yield* (yield* RuleRepo).list,
          programmes: yield* (yield* GuideRepo).programmes({
            start: DateTime.makeUnsafe(now),
            end: DateTime.makeUnsafe(now + PLANNING_HORIZON_MILLIS),
          }),
          recordings: yield* (yield* RecordingRepo).list,
          access,
          now,
          timeZone,
        });
        // The plan is made at the clock's now.
        yield* TestClock.setTime(now);
        const server = yield* (yield* Planning).inputs;

        // The fixture exercises both passes: Tatort cannot be served and moved to ONE,
        // Polizeiruf cannot be served and does not air again, so it stays planned, and the
        // hidden row never asked for a stream.
        assert.deepStrictEqual([...server.unserved].toSorted(), ["polizeiruf-one", "tatort-erste"]);
        assert.deepStrictEqual([...server.moved], ["tatort-erste"]);
        assert.deepStrictEqual(
          server.planned.map((plan) => plan.programme.id),
          ["alte-zdf", "tatort-erste", "polizeiruf-one", "tatort-one"],
        );

        assert.deepStrictEqual(server.planned, scheduler.planned);
        assert.deepStrictEqual(server.skipped, scheduler.skipped);
        assert.deepStrictEqual([...server.unserved], [...scheduler.unserved]);
        assert.deepStrictEqual([...server.moved], [...scheduler.moved]);
      }).pipe(Effect.provide(servicesIn(root)));
    }).pipe(Effect.scoped),
  );
});
