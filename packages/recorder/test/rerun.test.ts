/**
 * Skip repeats and the repeat fallback in the scheduler (recording model §3.6, §3.7, §5.2, §5.3),
 * over the memory adapters, with the real `seriesRule()` matcher.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  ChannelId,
  DAY,
  MINUTE,
  type Programme,
  type Recording,
  RecordingId,
  rerunState,
  type Rule,
  RuleId,
  seriesRule,
  UserId,
} from "@slipstream/domain";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";
import { type LineupSnapshot, RecordingRepo, type StoredRecording } from "../src/ports.ts";
import { RetentionSweeper } from "../src/retention.ts";
import { Scheduler } from "../src/scheduler.ts";
import {
  advance,
  alice,
  arte,
  at,
  bob,
  daserste,
  eventsOf,
  makeHarness,
  programme,
  recording,
  rule,
  skyF1,
  stream,
  T0,
  tvproxy,
  type Behaviour,
} from "./support.ts";

const one = ChannelId.make("one");
const carol = UserId.make("carol");

/** Every channel, ONE included, on tvproxy. */
const lineup: LineupSnapshot = {
  channels: [skyF1, daserste, one, arte].map((channelId) => ({
    channelId,
    streams: [stream(channelId, tvproxy)],
  })),
  sources: [{ id: tvproxy }],
};

const urlOf = (channelId: ChannelId) => `http://tvproxy.test/${channelId}.ts`;
const down: Behaviour = { _tag: "Down" };
const live: Behaviour = { _tag: "Live" };

const noPad = { beforeMinutes: 0, afterMinutes: 0 };

/** Tatort, Folge 1247 "Unter Wölfen", `from` to `to` minutes after T0. */
const tatort = (channelId: ChannelId, from: number, to: number, fields: Partial<Programme> = {}) =>
  programme(channelId, "Tatort", from, to, {
    subtitle: "Unter Wölfen",
    episode: { episode: 1247 },
    categories: ["Krimi"],
    ...fields,
  });

const tatortErste = tatort(daserste, 30, 120);
const tatortOne = tatort(one, 300, 390);

/** Kim's "Record series" on Das Erste, as the programme sheet makes it, owned by alice. */
const tatortSeries: Rule = rule("tatort-series", seriesRule(tatortErste, noPad).matcher, {
  skipRepeats: true,
});

/** The live race and its same-evening replay on Sky Sport F1. */
const raceLive = programme(skyF1, "Live F1: Rennen - GP Katar", 30, 180, {
  live: true,
  categories: ["Motorsport"],
});
const raceReplay = (from: number, to: number) =>
  programme(skyF1, "F1: Rennen - GP Katar (Wh.)", from, to, { categories: ["Motorsport"] });

/** "Record every “Live F1”" on Sky Sport F1. */
const f1Series: Rule = rule("f1-series", seriesRule(raceLive, noPad).matcher, {
  skipRepeats: true,
});

const recordings = Effect.gen(function* () {
  return yield* (yield* RecordingRepo).list;
});
const get = (id: RecordingId) =>
  Effect.gen(function* () {
    const found = yield* (yield* RecordingRepo).get(id);
    assert.isDefined(found);
    return found;
  });
const ofProgramme = (subject: Programme) =>
  Effect.map(recordings, (all) => all.filter((item) => item.programmeId === subject.id));
const onlyOf = (subject: Programme) =>
  Effect.map(ofProgramme(subject), (found) => {
    assert.strictEqual(found.length, 1, `one recording of ${subject.id}`);
    return found[0]!;
  });
const repeatsOf = (id: RecordingId) =>
  Effect.map(recordings, (all) => all.filter((item) => item.replacesId === id));

/** Where the chain of `original` stands, from what is stored. */
const chainOf = (id: RecordingId) =>
  Effect.gen(function* () {
    const all = yield* recordings;
    const original = all.find((item) => item.id === id);
    assert.isDefined(original);
    return rerunState(
      original,
      all.filter((item) => item.replacesId === id),
      [],
      yield* Effect.clockWith((clock) => clock.currentTimeMillis),
    )?.state;
  });

/** Moves the clock to `minute` after T0 in steps of `stepSeconds`. */
const until = (minute: number, stepSeconds = 10) =>
  Effect.gen(function* () {
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    const minutes = minute - (now - T0) / MINUTE;
    if (minutes > 0) yield* advance(minutes, stepSeconds);
  });

/** A damaged recording a series recording made earlier, still looking for its repeat. */
const damaged = (
  subject: Programme,
  ruleId: RuleId,
  fields: Partial<Recording> = {},
): Recording => {
  const { id: programmeId, ...info } = subject;
  return recording({
    ...info,
    id: RecordingId.make(`damaged-${subject.id}`),
    programmeId,
    state: "failed",
    problems: [{ _tag: "NoData" }],
    ruleId,
    rerunUntil: DateTime.makeUnsafe(DateTime.toEpochMillis(subject.end) + 14 * DAY),
    ...fields,
  });
};

const horizon = { horizonHours: 8 * 24 };

describe("the repeat fallback (§3.7)", () => {
  it.effect(
    "records the Tatort repeat on ONE after the airing failed, replaces it and purges it after 7 days",
    () =>
      Effect.gen(function* () {
        const behaviours: Record<string, Behaviour> = { [urlOf(daserste)]: down };
        const { layer } = yield* makeHarness({
          lineup,
          programmes: [tatortErste, tatortOne],
          rules: [tatortSeries],
          behaviours,
          scheduler: horizon,
        });
        yield* Effect.gen(function* () {
          yield* advance(0.1);
          // The ONE airing does not match the series recording's channel: only Das Erste.
          const original = yield* onlyOf(tatortErste);
          assert.deepStrictEqual(yield* ofProgramme(tatortOne), []);

          yield* until(125, 5);
          const failed = yield* get(original.id);
          assert.strictEqual(failed.state, "failed");
          assert.strictEqual(
            DateTime.toEpochMillis(failed.rerunUntil!),
            DateTime.toEpochMillis(tatortErste.end) + 14 * DAY,
          );
          const ended = (yield* eventsOf("RecordingEnded")).find(
            (event) => event.recordingId === original.id,
          );
          assert.strictEqual(ended?.rerun, "looking");

          // The nudge after finishing re-plans: the repeat on ONE is found by the episode.
          yield* advance(0.1);
          const repeat = yield* onlyOf(tatortOne);
          assert.strictEqual(repeat.replacesId, original.id);
          assert.strictEqual(repeat.ruleId, tatortSeries.id);
          assert.deepStrictEqual(repeat.ownerIds, [alice]);
          assert.strictEqual(yield* chainOf(original.id), "scheduled");

          yield* until(395, 10);
          const done = yield* get(repeat.id);
          assert.strictEqual(done.state, "completed");
          const hidden = yield* get(original.id);
          assert.strictEqual(hidden.replacedById, repeat.id);
          assert.isDefined(hidden.hiddenAt);
          assert.strictEqual(yield* chainOf(original.id), "replaced");
          const replaced = yield* eventsOf("RecordingReplaced");
          assert.deepStrictEqual(
            replaced.map((event) => [event.id, event.replacedId]),
            [[repeat.id, original.id]],
          );
          const repeatEnded = (yield* eventsOf("RecordingEnded")).find(
            (event) => event.recordingId === repeat.id,
          );
          assert.strictEqual(repeatEnded?.rerun, "replaced");

          // Hidden for 7 days, then the janitor purges the row.
          const sweeper = yield* RetentionSweeper;
          yield* sweeper.sweep;
          assert.isDefined((yield* recordings).find((item) => item.id === original.id));
          yield* TestClock.adjust(7 * DAY);
          const report = yield* sweeper.sweep;
          assert.include(report.recordingIds, original.id);
          assert.isUndefined((yield* recordings).find((item) => item.id === original.id));
          assert.isDefined((yield* recordings).find((item) => item.id === repeat.id));
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("records the F1 replay marked (Wh.) after the live race failed", () =>
    Effect.gen(function* () {
      const replay = raceReplay(600, 750);
      const behaviours: Record<string, Behaviour> = { [urlOf(skyF1)]: down };
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [raceLive, replay],
        rules: [f1Series],
        behaviours,
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const original = yield* onlyOf(raceLive);
        // The replay fails "title starts with “Live F1:”": nothing plans it yet.
        assert.deepStrictEqual(yield* ofProgramme(replay), []);
        yield* until(185, 5);
        assert.strictEqual((yield* get(original.id)).state, "failed");
        behaviours[urlOf(skyF1)] = live;
        yield* advance(0.1);
        const repeat = yield* onlyOf(replay);
        assert.strictEqual(repeat.replacesId, original.id);

        yield* until(600, 60);
        yield* until(755, 10);
        assert.strictEqual((yield* get(repeat.id)).state, "completed");
        assert.strictEqual((yield* get(original.id)).replacedById, repeat.id);
        assert.lengthOf(yield* eventsOf("RecordingReplaced"), 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps both when the repeat is shorter than 90 % of the original", () =>
    Effect.gen(function* () {
      // A 90-minute replay of a 150-minute live broadcast.
      const replay = raceReplay(600, 690);
      const behaviours: Record<string, Behaviour> = { [urlOf(skyF1)]: down };
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [raceLive, replay],
        rules: [f1Series],
        behaviours,
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const original = yield* onlyOf(raceLive);
        yield* until(185, 5);
        behaviours[urlOf(skyF1)] = live;
        yield* advance(0.1);
        const repeat = yield* onlyOf(replay);
        yield* until(600, 60);
        yield* until(695, 10);
        assert.strictEqual((yield* get(repeat.id)).state, "completed");
        const kept = yield* get(original.id);
        assert.strictEqual(kept.rerunOutcome, "kept");
        assert.isUndefined(kept.replacedById);
        assert.isUndefined(kept.hiddenAt);
        assert.strictEqual(yield* chainOf(original.id), "kept");
        assert.deepStrictEqual(yield* eventsOf("RecordingReplaced"), []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("tries a second repeat when the first fails too, then gives up", () =>
    Effect.gen(function* () {
      const first = tatort(one, 200, 290);
      const second = tatort(arte, 400, 490);
      const third = tatort(one, 600, 690);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [tatortErste, first, second, third],
        rules: [tatortSeries],
        behaviours: { "tvproxy.test": down },
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const original = yield* onlyOf(tatortErste);
        yield* until(125, 5);
        assert.strictEqual((yield* onlyOf(first)).replacesId, original.id);

        yield* until(295, 10);
        assert.strictEqual((yield* onlyOf(first)).state, "failed");
        assert.strictEqual((yield* get(original.id)).rerunAttempts, 1);
        assert.strictEqual(yield* chainOf(original.id), "scheduled");
        // The second try, on arte, still repeats the original (never the failed repeat).
        assert.strictEqual((yield* onlyOf(second)).replacesId, original.id);

        yield* until(495, 10);
        assert.strictEqual((yield* onlyOf(second)).state, "failed");
        assert.strictEqual((yield* get(original.id)).rerunAttempts, 2);
        assert.strictEqual(yield* chainOf(original.id), "exhausted");
        const secondId = (yield* onlyOf(second)).id;
        const ended = (yield* eventsOf("RecordingEnded")).find(
          (event) => event.recordingId === secondId,
        );
        assert.strictEqual(ended?.rerun, "exhausted");
        yield* (yield* Scheduler).replan;
        assert.deepStrictEqual(yield* ofProgramme(third), []);
        // Failed repeats are not replaced by anything: they stay visible, nothing is hidden.
        assert.isTrue((yield* recordings).every((item) => item.hiddenAt === undefined));
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("stops looking 14 days after the programme ended", () =>
    Effect.gen(function* () {
      // The original ended 14 days ago minus 10 minutes, so it looks for 10 more minutes.
      const old = tatort(daserste, -14 * 24 * 60 - 80, -14 * 24 * 60 + 10);
      const original = damaged(old, tatortSeries.id);
      const repeatAiring = tatort(one, 60, 150);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [repeatAiring],
        rules: [tatortSeries],
        recordings: [original],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        // The next airing starts after the deadline: it is no repeat of the original any more.
        assert.deepStrictEqual(yield* ofProgramme(repeatAiring), []);
        assert.strictEqual(yield* chainOf(original.id), "looking");
        yield* until(16, 30);
        assert.strictEqual(yield* chainOf(original.id), "exhausted");
        yield* until(70, 60);
        assert.deepStrictEqual(yield* ofProgramme(repeatAiring), []);
        assert.isUndefined((yield* get(original.id)).hiddenAt);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "goes back to looking when the guide drops the planned repeat, then finds a new one",
    () =>
      Effect.gen(function* () {
        const original = damaged(tatort(daserste, -200, -110), tatortSeries.id);
        const onOne = tatort(one, 60, 150);
        const onArte = tatort(arte, 300, 390);
        const { harness, layer } = yield* makeHarness({
          lineup,
          programmes: [onOne],
          rules: [tatortSeries],
          recordings: [original],
          scheduler: horizon,
        });
        yield* Effect.gen(function* () {
          yield* advance(0.1);
          assert.strictEqual((yield* onlyOf(onOne)).replacesId, original.id);

          yield* harness.guide.replace([]);
          yield* advance(0.1);
          assert.deepStrictEqual(yield* repeatsOf(original.id), []);
          assert.strictEqual(yield* chainOf(original.id), "looking");

          yield* harness.guide.replace([onArte]);
          yield* advance(0.1);
          const found = yield* onlyOf(onArte);
          assert.strictEqual(found.replacesId, original.id);
          assert.strictEqual(yield* chainOf(original.id), "scheduled");
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("declines the chain when someone skips the planned repeat, and never replans it", () =>
    Effect.gen(function* () {
      const original = damaged(tatort(daserste, -200, -110), tatortSeries.id);
      const onOne = tatort(one, 60, 150);
      const onArte = tatort(arte, 300, 390);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [onOne, onArte],
        rules: [tatortSeries],
        recordings: [original],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(0.1);
        const planned = yield* onlyOf(onOne);
        const skipped = yield* scheduler.stop(planned.id);
        assert.strictEqual(skipped.state, "cancelled");
        assert.strictEqual((yield* get(original.id)).rerunOutcome, "declined");
        assert.strictEqual(yield* chainOf(original.id), "declined");

        yield* scheduler.replan;
        yield* advance(0.1);
        assert.strictEqual((yield* onlyOf(onOne)).state, "cancelled");
        assert.deepStrictEqual(yield* ofProgramme(onArte), []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps a protected original beside its good repeat", () =>
    Effect.gen(function* () {
      const original = damaged(tatort(daserste, -200, -110), tatortSeries.id, {
        protected: true,
        labels: ["Krimi"],
      });
      const onOne = tatort(one, 30, 120);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [onOne],
        rules: [tatortSeries],
        recordings: [original],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const repeat = yield* onlyOf(onOne);
        yield* until(125, 5);
        assert.strictEqual((yield* get(repeat.id)).state, "completed");
        const kept = yield* get(original.id);
        assert.isUndefined(kept.hiddenAt);
        assert.isUndefined(kept.replacedById);
        assert.strictEqual(kept.rerunOutcome, "kept");
        assert.deepStrictEqual(yield* eventsOf("RecordingReplaced"), []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("hands owners, labels and the pinned collection to the repeat that replaces", () =>
    Effect.gen(function* () {
      const original = damaged(tatort(daserste, -200, -110), tatortSeries.id, {
        ownerIds: [alice, bob],
        labels: ["Krimi"],
      });
      const onOne = tatort(one, 30, 120);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [onOne],
        rules: [tatortSeries],
        recordings: [original],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const repeat = yield* onlyOf(onOne);
        // A planned repeat already belongs to the original's owners.
        assert.deepStrictEqual(repeat.ownerIds, [alice, bob]);
        yield* until(125, 5);
        const done = yield* get(repeat.id);
        assert.strictEqual(done.state, "completed");
        assert.deepStrictEqual(done.ownerIds, [alice, bob]);
        assert.deepStrictEqual(done.labels, ["Krimi"]);
        assert.strictEqual((yield* get(original.id)).replacedById, repeat.id);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("re-plans after a recording ends without deadlocking on the tick lock", () =>
    Effect.gen(function* () {
      const onOne = tatort(one, 200, 290);
      const other = programme(arte, "Arte Journal", 115, 140);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [tatortErste, onOne, other],
        rules: [tatortSeries],
        behaviours: { [urlOf(daserste)]: down },
        scheduler: horizon,
        slowRepo: true,
      });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(0.1);
        const original = yield* onlyOf(tatortErste);
        yield* until(120, 5);
        // The recording ends while requests and a re-plan race for the lock.
        yield* Effect.all(
          [
            advance(0.5),
            scheduler.replan,
            scheduler.recordProgramme(other.id, { ownerId: bob }),
            scheduler.replan,
          ],
          { concurrency: "unbounded" },
        );
        yield* advance(0.1);
        assert.strictEqual((yield* get(original.id)).state, "failed");
        assert.strictEqual((yield* onlyOf(onOne)).replacesId, original.id);
        assert.lengthOf(yield* ofProgramme(other), 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("lets two damaged originals on different channels share one repeat", () =>
    Effect.gen(function* () {
      const onArte = tatort(arte, -400, -310);
      /** Bob's series recording on arte. */
      const arteSeries = rule("tatort-arte", seriesRule(onArte, noPad).matcher, {
        ownerId: bob,
        skipRepeats: true,
      });
      const first = damaged(tatort(daserste, -200, -110), tatortSeries.id, { labels: ["Krimi"] });
      const second = damaged(onArte, arteSeries.id, { ownerIds: [bob], labels: ["Bob"] });
      const onOne = tatort(one, 30, 120);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [onOne],
        rules: [tatortSeries, arteSeries],
        recordings: [first, second],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        // One repeat for both, owned by both originals' owners.
        const repeat = yield* onlyOf(onOne);
        assert.strictEqual(repeat.replacesId, first.id);
        assert.deepStrictEqual(repeat.ownerIds, [alice, bob]);

        yield* until(125, 5);
        const done = yield* get(repeat.id);
        assert.strictEqual(done.state, "completed");
        assert.deepStrictEqual(done.labels, ["Krimi", "Bob"]);
        for (const original of [first, second]) {
          const hidden = yield* get(original.id);
          assert.strictEqual(hidden.replacedById, repeat.id);
          assert.strictEqual(hidden.hiddenReason, "replaced");
          assert.isDefined(hidden.hiddenAt);
        }
        const replaced = yield* eventsOf("RecordingReplaced");
        assert.deepStrictEqual(
          replaced.map((event) => event.replacedId),
          [first.id, second.id],
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("never replaces the original with a repeat someone stopped", () =>
    Effect.gen(function* () {
      const airing = tatort(daserste, -200, -110);
      // Five minutes missing: a repeat stopped at 92 % misses more (7 of 90 minutes).
      const original = damaged(airing, tatortSeries.id, {
        state: "incomplete",
        problems: [{ _tag: "Gap", range: { start: airing.start, end: at(-195) } }],
      });
      const onOne = tatort(one, 30, 120);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [onOne],
        rules: [tatortSeries],
        recordings: [original],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(0.1);
        const repeat = yield* onlyOf(onOne);
        yield* until(30 + 83, 5);
        yield* scheduler.stop(repeat.id);
        yield* until(125, 5);
        const done = yield* get(repeat.id);
        assert.strictEqual(done.state, "completed");
        const kept = yield* get(original.id);
        assert.isUndefined(kept.replacedById);
        assert.isUndefined(kept.hiddenAt);
        assert.strictEqual(kept.rerunOutcome, "kept");
        assert.deepStrictEqual(yield* eventsOf("RecordingReplaced"), []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("leaves a deleted original deleted when its repeat is good, and looks no further", () =>
    Effect.gen(function* () {
      const anchor = damaged(tatort(daserste, -200, -110), tatortSeries.id, {
        hiddenAt: at(-100),
        hiddenReason: "deleted",
      });
      const onOne = tatort(one, 30, 120);
      const onArte = tatort(arte, 300, 390);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [onOne, onArte],
        rules: [tatortSeries],
        recordings: [anchor],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const repeat = yield* onlyOf(onOne);
        yield* until(125, 5);
        assert.strictEqual((yield* get(repeat.id)).state, "completed");
        const deleted = yield* get(anchor.id);
        assert.strictEqual(deleted.hiddenReason, "deleted");
        assert.isUndefined(deleted.replacedById);
        assert.strictEqual(DateTime.toEpochMillis(deleted.hiddenAt!), T0 - 100 * MINUTE);
        assert.deepStrictEqual(yield* eventsOf("RecordingReplaced"), []);
        // The good repeat holds the episode: no second repeat on arte.
        yield* advance(0.1);
        assert.deepStrictEqual(yield* ofProgramme(onArte), []);
      }).pipe(Effect.provide(layer));
    }),
  );
});

/** A series recording of Tatort on any channel. */
const anyTatort = (id: string, fields: Partial<Rule> = {}) =>
  rule(
    id,
    { title: [{ _tag: "IsExactly", values: ["Tatort"] }] },
    { skipRepeats: true, ...fields },
  );

describe("planning with repeats (§5.2, §5.3)", () => {
  const snapshot = Effect.map(recordings, (all) =>
    all
      .map((item) => ({ ...item, createdAt: DateTime.toEpochMillis(item.createdAt) }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  );

  it.effect("plans the same every time and never inserts twice", () =>
    Effect.gen(function* () {
      const series = anyTatort("tatort", { ownerId: bob });
      const original = damaged(tatort(daserste, -200, -110), series.id, {
        ownerIds: [bob],
      });
      const sunday = tatort(daserste, 60, 150, {
        subtitle: "Der Fall",
        episode: { episode: 1300 },
      });
      const tuesday = tatort(one, 600, 690, { subtitle: "Der Fall", episode: { episode: 1300 } });
      const repeatAiring = tatort(arte, 300, 390);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [sunday, tuesday, repeatAiring],
        rules: [series],
        recordings: [original],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(0.1);
        const first = yield* snapshot;
        // Sunday's episode, and the repeat for the damaged original; Tuesday is left out.
        assert.lengthOf(yield* ofProgramme(sunday), 1);
        assert.deepStrictEqual(yield* ofProgramme(tuesday), []);
        assert.strictEqual((yield* onlyOf(repeatAiring)).replacesId, original.id);
        assert.lengthOf(first, 3);
        yield* scheduler.replan;
        yield* scheduler.replan;
        assert.deepStrictEqual(yield* snapshot, first);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("sends the second pass to the later airing when the first cannot be served", () =>
    Effect.gen(function* () {
      const series = anyTatort("tatort");
      const sunday = tatort(daserste, 60, 150);
      const tuesday = tatort(one, 600, 690);
      // The sources cannot serve anything around Sunday evening.
      const busy = { startMs: T0 + 50 * MINUTE, endMs: T0 + 200 * MINUTE };
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [sunday, tuesday],
        rules: [series],
        scheduler: horizon,
        planning: {
          unserved: (items) =>
            new Set(
              items
                .filter(
                  (item) =>
                    DateTime.toEpochMillis(item.range.start) < busy.endMs &&
                    busy.startMs < DateTime.toEpochMillis(item.range.end),
                )
                .map((item) => item.id),
            ),
        },
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        // The unserved copy stays scheduled; the served later airing is planned too.
        assert.strictEqual((yield* onlyOf(sunday)).state, "scheduled");
        assert.strictEqual((yield* onlyOf(tuesday)).state, "scheduled");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("leaves the later airing out when the first can be served", () =>
    Effect.gen(function* () {
      const sunday = tatort(daserste, 60, 150);
      const tuesday = tatort(one, 600, 690);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [sunday, tuesday],
        rules: [anyTatort("tatort")],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        assert.lengthOf(yield* ofProgramme(sunday), 1);
        assert.deepStrictEqual(yield* ofProgramme(tuesday), []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("decides per rule: one leaves the episode out, the other records every airing", () =>
    Effect.gen(function* () {
      const alices = anyTatort("alice-tatort");
      const bobs = anyTatort("bob-tatort", { ownerId: bob, skipRepeats: false });
      const { id: _id, ...earlier } = tatort(daserste, -200, -110);
      const copy = recording({ ...earlier, id: RecordingId.make("copy"), state: "completed" });
      const onOne = tatort(one, 60, 150);
      const { layer } = yield* makeHarness({
        lineup,
        programmes: [onOne],
        rules: [alices, bobs],
        recordings: [copy],
        scheduler: horizon,
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const planned = yield* onlyOf(onOne);
        assert.strictEqual(planned.ruleId, bobs.id);
        assert.deepStrictEqual(planned.ownerIds, [bob]);
        // Alice has the episode already.
        assert.deepStrictEqual((yield* get(copy.id)).ownerIds, [alice]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "adds owners of a rule that left the episode out, with that rule, but never a decliner",
    () =>
      Effect.gen(function* () {
        const alices = anyTatort("alice-tatort");
        const carols = anyTatort("carol-tatort", { ownerId: carol });
        const { id: _id, ...earlier } = tatort(daserste, -200, -110);
        const copy = recording({
          ...earlier,
          id: RecordingId.make("copy"),
          state: "completed",
          ownerIds: [bob],
        });
        const onOne = tatort(one, 60, 150);
        const { layer } = yield* makeHarness({
          lineup,
          programmes: [onOne],
          rules: [alices, carols],
          recordings: [copy],
          scheduler: horizon,
        });
        yield* Effect.gen(function* () {
          const repo = yield* RecordingRepo;
          // Carol left the copy before the plan ran.
          yield* repo.update(copy.id, (current) => ({ ...current, declinedBy: [carol] }));
          yield* (yield* Scheduler).replan;
          const shared: StoredRecording = yield* get(copy.id);
          assert.deepStrictEqual(shared.ownerIds, [bob, alice]);
          assert.deepStrictEqual(shared.ownersAddedBy, { [alice]: alices.id });
          assert.isUndefined(shared.ownersAddedBy?.[carol]);
          // Both rules left the airing out: nothing records it a second time.
          assert.deepStrictEqual(yield* ofProgramme(onOne), []);
        }).pipe(Effect.provide(layer));
      }),
  );
});
