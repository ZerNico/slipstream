import { assert, describe, it } from "@effect/vitest";
import { applyRetention, MINUTE, type Recording, RecordingId, RuleId } from "@slipstream/domain";
import { Effect, Scope } from "effect";
import { CaptureManager } from "../src/capture-manager.ts";
import { DiskGuard } from "../src/disk-guard.ts";
import { RecordingRepo, SegmentRepo, type StoredSegment } from "../src/ports.ts";
import {
  expiredRecordings,
  RetentionSweeper,
  unretainedSegments,
  type RetentionGroup,
} from "../src/retention.ts";
import {
  advance,
  at,
  daserste,
  eventsOf,
  makeHarness,
  recording,
  rule,
  skyF1,
  T0,
} from "./support.ts";

const DAY = 24 * 60;

/** A finished recording `daysAgo` days back, one hour long. */
const finished = (id: string, daysAgo: number, fields: Partial<Recording> = {}): Recording =>
  recording({
    id: RecordingId.make(id),
    state: "completed",
    start: at(-daysAgo * DAY),
    end: at(-daysAgo * DAY + 60),
    ...fields,
  });

/** One session of a race weekend, labelled with its event. */
const weekend = (id: string, daysAgo: number, event: string) =>
  finished(id, daysAgo, { labels: [event] });

/** A finished recording made by the "f1" rule. */
const fromRule = (id: string, daysAgo: number) =>
  finished(id, daysAgo, { ruleId: RuleId.make("f1") });

const group = (
  retention: RetentionGroup["retention"],
  members: ReadonlyArray<Recording>,
  eventOf?: RetentionGroup["eventOf"],
): RetentionGroup => ({
  id: "group",
  retention,
  recordingIds: members.map((member) => member.id),
  eventOf,
});

const sorted = (ids: Iterable<string>) => [...ids].toSorted();

/** Every recording is its own event, except "no-event", whose title has no event part. */
const eventOf = (member: Recording) => (member.id === "no-event" ? undefined : member.id);

describe("expiredRecordings", () => {
  const races = [
    finished("r1", 1),
    finished("r2", 8),
    finished("r3", 15),
    finished("r4", 22),
    finished("r5", 29, { protected: true }),
    recording({ id: RecordingId.make("running"), state: "recording", start: at(-30), end: at(30) }),
  ];

  it("keeps the newest N, never touching protected or running recordings", () => {
    // The running recording is about to be the newest, so it takes one of the two places.
    const expired = expiredRecordings(races, [group({ _tag: "KeepNewest", count: 2 }, races)], T0);
    assert.deepStrictEqual(sorted(expired), ["r2", "r3", "r4"]);
  });

  it("agrees with the domain's applyRetention, which the retention preview shows", () => {
    const policies: ReadonlyArray<RetentionGroup["retention"]> = [
      { _tag: "KeepNewest", count: 2 },
      { _tag: "KeepDays", days: 10 },
      { _tag: "KeepNewestEvents", count: 1 },
      { _tag: "KeepAll" },
    ];
    const members = [...races, finished("no-event", 3, { labels: [] })];
    for (const retention of policies) {
      const items = members.map((member) => ({ ...member, event: eventOf(member) }));
      const preview = applyRetention(retention, items, T0).remove.map((entry) => entry.item.id);
      const swept = expiredRecordings(members, [group(retention, members, eventOf)], T0);
      assert.deepStrictEqual(sorted(swept), sorted(preview), retention._tag);
    }
    // A newest-events policy cannot place a recording without an event part, so it stays.
    const swept = expiredRecordings(
      members,
      [group({ _tag: "KeepNewestEvents", count: 1 }, members, eventOf)],
      T0,
    );
    assert.isFalse(swept.has(RecordingId.make("no-event")));
  });

  it("keeps everything newer than X days", () => {
    const expired = expiredRecordings(races, [group({ _tag: "KeepDays", days: 10 }, races)], T0);
    assert.deepStrictEqual(sorted(expired), ["r3", "r4"]);
  });

  it("keeps the newest N events, counting a weekend of sessions as one", () => {
    const sessions = [
      weekend("abu-dhabi-race", 1, "Abu Dhabi"),
      weekend("abu-dhabi-quali", 2, "Abu Dhabi"),
      weekend("qatar-race", 8, "Qatar"),
      weekend("qatar-sprint", 9, "Qatar"),
      weekend("vegas-race", 15, "Las Vegas"),
    ];
    const expired = expiredRecordings(
      sessions,
      [group({ _tag: "KeepNewestEvents", count: 2 }, sessions, (member) => member.labels[0])],
      T0,
    );
    assert.deepStrictEqual(sorted(expired), ["vegas-race"]);
  });

  it("deletes a recording only when every group it is in lets it go", () => {
    const old = finished("old", 30);
    const groups = [
      { ...group({ _tag: "KeepDays", days: 7 }, [old]), id: "rule" },
      { ...group({ _tag: "KeepAll" }, [old]), id: "collection" },
    ];
    assert.deepStrictEqual(sorted(expiredRecordings([old], groups, T0)), []);
    assert.deepStrictEqual(sorted(expiredRecordings([old], groups.slice(0, 1), T0)), ["old"]);
    assert.deepStrictEqual(sorted(expiredRecordings([old], [], T0)), []);
  });
});

const segment = (
  channelId: typeof skyF1,
  fromMinutes: number,
  sequence: number,
): StoredSegment => ({
  channelId,
  captureId: `${channelId}-capture`,
  runId: "run",
  sequence,
  startMs: T0 + fromMinutes * MINUTE,
  durationMs: MINUTE,
  bytes: 1000,
  path: `${sequence}.ts`,
  directory: `/store/${channelId}`,
});

describe("unretainedSegments", () => {
  it("keeps segments a recording range or a live window covers", () => {
    const segments = [0, 1, 2, 3, 4, 5].map((minute) => segment(skyF1, minute, minute));
    const kept = recording({ state: "completed", start: at(1), end: at(2) });
    const cancelled = recording({
      id: RecordingId.make("cancelled"),
      state: "cancelled",
      start: at(3),
      end: at(4),
    });
    const doomed = unretainedSegments(
      [...segments, segment(daserste, 0, 100)],
      [kept, cancelled],
      [{ channelId: skyF1, fromMs: T0 + 4.5 * MINUTE }],
    );
    assert.deepStrictEqual(
      doomed.map((item) => `${item.channelId}:${item.sequence}`),
      ["sky-f1:0", "sky-f1:2", "sky-f1:3", "das-erste:100"],
    );
  });
});

describe("RetentionSweeper and DiskGuard", () => {
  const keepNewestOne = rule("f1", {}, { retention: { _tag: "KeepNewest", count: 1 } });

  it.effect("deletes expired recordings and the segment files only they needed", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({
        rules: [keepNewestOne],
        recordings: [fromRule("new", 1), fromRule("old", 8)],
      });
      yield* Effect.gen(function* () {
        const segments = yield* SegmentRepo;
        yield* segments.add(segment(skyF1, -DAY, 1));
        yield* segments.add(segment(skyF1, -8 * DAY, 2));
        const report = yield* (yield* RetentionSweeper).sweep;
        assert.deepStrictEqual(report, {
          recordingIds: [RecordingId.make("old")],
          segments: 1,
          bytes: 1000,
        });
        assert.deepStrictEqual(
          (yield* (yield* RecordingRepo).list).map((item) => item.id),
          ["new"],
        );
        assert.deepStrictEqual(yield* harness.storage.removed, [`/store/${skyF1}/2.ts`]);
        assert.deepStrictEqual(
          (yield* segments.list).map((item) => item.sequence),
          [1],
        );
        assert.strictEqual((yield* eventsOf("RetentionSwept")).length, 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the index entry of a segment file it could not delete, for the next sweep", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({
        rules: [keepNewestOne],
        recordings: [fromRule("new", 1), fromRule("old", 8)],
      });
      yield* Effect.gen(function* () {
        const segments = yield* SegmentRepo;
        yield* segments.add(segment(skyF1, -8 * DAY, 2));
        yield* segments.add(segment(skyF1, -8 * DAY + 1, 3));
        yield* harness.storage.setRefused(`/store/${skyF1}/2.ts`, true);
        const first = yield* (yield* RetentionSweeper).sweep;
        assert.strictEqual(first.segments, 1);
        assert.deepStrictEqual(
          (yield* segments.list).map((item) => item.sequence),
          [2],
        );

        yield* harness.storage.setRefused(`/store/${skyF1}/2.ts`, false);
        const second = yield* (yield* RetentionSweeper).sweep;
        assert.strictEqual(second.segments, 1);
        assert.deepStrictEqual(yield* segments.list, []);
        assert.deepStrictEqual(yield* harness.storage.removed, [
          `/store/${skyF1}/3.ts`,
          `/store/${skyF1}/2.ts`,
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("shrinks live DVR windows first, warns once, never cuts a running recording", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({
        freeBytes: 10_000_000,
        manager: { dvrWindowMs: 60 * MINUTE },
        // A recording that was running when the server started, until two hours from now.
        recordings: [
          recording({
            id: RecordingId.make("race"),
            state: "recording",
            start: at(0),
            end: at(120),
          }),
        ],
      });
      yield* Effect.gen(function* () {
        const manager = yield* CaptureManager;
        const scope = yield* Scope.make();
        yield* manager.acquire(daserste, { id: "sofa", kind: "live" }).pipe(Scope.provide(scope));
        // An hour of live and recorded segments, one per minute.
        yield* advance(60, 30);
        const segments = yield* SegmentRepo;
        assert.strictEqual((yield* segments.list).length, 1200);

        // 120 segment files of 1000 bytes each must go to get back above the floor.
        const guard = yield* DiskGuard;
        yield* harness.storage.setFreeBytes(0);
        const low = yield* guard.check;
        assert.strictEqual(low._tag, "Low");
        assert.strictEqual(yield* manager.dvrWindowMs, 5 * MINUTE);
        const remaining = yield* segments.list;
        const live = remaining.filter((item) => item.channelId === daserste);
        const recorded = remaining.filter((item) => item.channelId === skyF1);
        assert.strictEqual(recorded.length, 600);
        assert.isTrue(live.length <= 51);
        assert.strictEqual((yield* eventsOf("DiskSpaceLow")).length, 1);

        // Still low: no second warning.
        yield* guard.check;
        assert.strictEqual((yield* eventsOf("DiskSpaceLow")).length, 1);

        yield* harness.storage.setFreeBytes(10_000_000);
        const ok = yield* guard.check;
        assert.strictEqual(ok._tag, "Ok");
        assert.strictEqual((yield* eventsOf("DiskSpaceRecovered")).length, 1);
        assert.strictEqual(yield* manager.dvrWindowMs, 60 * MINUTE);
      }).pipe(
        Effect.provide(DiskGuard.layer({ floorBytes: 1_000_000, intervalMs: 3_600_000 })),
        Effect.provide(layer),
      );
    }),
  );
});
