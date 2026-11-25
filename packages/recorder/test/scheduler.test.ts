import { assert, describe, it } from "@effect/vitest";
import { MINUTE, RecordingId } from "@slipstream/domain";
import { DateTime, Effect, Fiber } from "effect";
import { RecordingRepo, SegmentRepo } from "../src/ports.ts";
import { Scheduler } from "../src/scheduler.ts";
import {
  advance,
  alice,
  at,
  bob,
  daserste,
  eventsOf,
  makeHarness,
  programme,
  recording,
  rule,
  singleSource,
  skyF1,
  T0,
  type Behaviour,
} from "./support.ts";

const f1 = rule(
  "f1",
  { channels: [skyF1], title: [{ _tag: "StartsWith", values: ["Live F1:"] }] },
  { padding: { beforeMinutes: 5, afterMinutes: 10 } },
);
const race = programme(skyF1, "Live F1: Rennen", 30, 60);
const magazine = programme(skyF1, "F1 Magazin", 60, 90);
const tatort = programme(daserste, "Tatort", 50, 80);

const url = `http://tvproxy.test/${skyF1}.ts`;

const recordings = Effect.gen(function* () {
  return yield* (yield* RecordingRepo).list;
});
const only = Effect.map(recordings, (all) => {
  assert.strictEqual(all.length, 1);
  return all[0]!;
});
const byTitle = (title: string) =>
  Effect.map(recordings, (all) => all.find((item) => item.title === title));

const minutesAfterT0 = (instant: DateTime.Utc) => (DateTime.toEpochMillis(instant) - T0) / MINUTE;

/** The F1 rule and race, with Sky F1's upstream acting as `behaviour`. */
const withBehaviour = (behaviour: Behaviour) =>
  makeHarness({ programmes: [race], rules: [f1], behaviours: { [url]: behaviour } });

describe("Scheduler", () => {
  it.effect("records a rule match from start minus padding to end plus padding", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({
        programmes: [race, magazine],
        rules: [f1],
      });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const scheduled = yield* only;
        assert.strictEqual(scheduled.state, "scheduled");
        assert.strictEqual(scheduled.ruleId, f1.id);
        assert.strictEqual(scheduled.programmeId, race.id);
        assert.deepStrictEqual(scheduled.padding, f1.padding);
        assert.deepStrictEqual(scheduled.ownerIds, [alice]);

        yield* advance(24.8, 2);
        assert.deepStrictEqual(harness.log.started, []);
        yield* advance(0.2);
        assert.strictEqual((yield* only).state, "recording");
        assert.deepStrictEqual(harness.log.started, [url]);
        const [started] = yield* eventsOf("RecordingStarted");
        assert.strictEqual(minutesAfterT0(started!.at), 25);

        // Padded end is 70; the capture keeps going for the grace period, then stops.
        yield* advance(45, 2);
        assert.strictEqual((yield* only).state, "recording");
        yield* advance(0.2);
        const done = yield* only;
        assert.strictEqual(done.state, "completed");
        assert.deepStrictEqual(done.problems, []);
        assert.strictEqual(harness.log.active.get(url), 0);
        const ended = yield* eventsOf("RecordingEnded");
        assert.deepStrictEqual(
          ended.map((event) => event.state),
          ["completed"],
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("re-plans when the guide moves a programme or the rules change", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ programmes: [race], rules: [f1] });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const first = yield* only;

        yield* harness.guide.replace([
          { ...race, start: at(40), end: at(75), title: "Live F1: Das Rennen" },
        ]);
        yield* advance(0.1);
        const moved = yield* only;
        assert.strictEqual(moved.id, first.id);
        assert.strictEqual(minutesAfterT0(moved.start), 40);
        assert.strictEqual(minutesAfterT0(moved.end), 75);
        // Names are a snapshot from scheduling time.
        assert.strictEqual(moved.title, "Live F1: Rennen");

        yield* harness.rules.replace([{ ...f1, enabled: false }]);
        yield* advance(0.1);
        assert.deepStrictEqual(yield* recordings, []);

        yield* harness.rules.replace([f1]);
        yield* advance(0.1);
        assert.strictEqual((yield* only).state, "scheduled");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("records one-off programmes and ranges, sharing a duplicate between owners", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({ programmes: [race, magazine, tatort] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const mine = yield* scheduler.recordProgramme(tatort.id, {
          ownerId: alice,
          padding: { beforeMinutes: 2, afterMinutes: 5 },
        });
        const theirs = yield* scheduler.recordProgramme(tatort.id, { ownerId: bob });
        assert.strictEqual(theirs.id, mine.id);
        assert.deepStrictEqual(theirs.ownerIds, [alice, bob]);

        const manual = yield* scheduler.recordRange({
          channelId: skyF1,
          title: "Boxengasse",
          start: at(5),
          end: at(15),
          ownerId: alice,
        });
        assert.strictEqual(manual.state, "scheduled");
        assert.strictEqual((yield* recordings).length, 2);

        const missing = yield* Effect.flip(
          scheduler.recordProgramme(programme(skyF1, "Nope", 0, 1).id, { ownerId: alice }),
        );
        assert.strictEqual(missing._tag, "ProgrammeNotFound");

        yield* advance(5.1);
        assert.strictEqual((yield* byTitle("Boxengasse"))?.state, "recording");
        yield* advance(10.2);
        assert.strictEqual((yield* byTitle("Boxengasse"))?.state, "completed");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("extends and stops a running recording", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ programmes: [race], rules: [f1] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(40, 2);
        const running = yield* only;
        assert.strictEqual(running.state, "recording");

        const extended = yield* scheduler.extend(running.id, 30);
        assert.deepStrictEqual(extended.padding, { beforeMinutes: 5, afterMinutes: 40 });
        yield* advance(40, 2);
        assert.strictEqual((yield* only).state, "recording");

        const stopped = yield* scheduler.stop(running.id);
        // The programme times stay; the extra minutes after it shrink to end now.
        assert.strictEqual(minutesAfterT0(stopped.end), 60);
        assert.strictEqual(stopped.padding.afterMinutes, 20);
        // Whoever waits for it to settle waits until the last segment landed and it ended.
        const settling = yield* Effect.forkChild(scheduler.settled(running.id));
        yield* advance(0);
        assert.isUndefined(settling.pollUnsafe());
        yield* advance(0.2);
        const done = yield* only;
        assert.strictEqual(done.state, "completed");
        yield* Fiber.join(settling);
        // One that ended already settles at once.
        yield* scheduler.settled(running.id);
        assert.strictEqual(harness.log.active.get(url), 0);
        const [ended] = yield* eventsOf("RecordingEnded");
        assert.strictEqual(ended?.reason, "stopped");

        const again = yield* Effect.flip(scheduler.extend(running.id, 10));
        assert.strictEqual(again._tag, "RecordingNotActive");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("cancels a scheduled recording that is stopped before it starts", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ programmes: [race], rules: [f1] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(0.1);
        const cancelled = yield* scheduler.stop((yield* only).id);
        assert.strictEqual(cancelled.state, "cancelled");
        // The rule does not bring it back.
        yield* scheduler.replan;
        yield* advance(30, 5);
        assert.strictEqual((yield* only).state, "cancelled");
        assert.deepStrictEqual(harness.log.started, []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("starts a conflicting recording late when the stream frees up", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({
        lineup: singleSource(1),
        programmes: [race, tatort],
        rules: [f1],
      });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(0.1);
        yield* scheduler.recordProgramme(tatort.id, { ownerId: bob });
        yield* advance(85, 5);
        const done = (yield* byTitle("Tatort"))!;
        assert.strictEqual(done.state, "incomplete");
        assert.strictEqual(done.problems.length, 1);
        const problem = done.problems[0]!;
        assert.strictEqual(problem._tag, "SourceLimitReached");
        if (problem._tag === "SourceLimitReached") {
          assert.strictEqual(minutesAfterT0(problem.range.start), 50);
          // The race (padded to 70) keeps its stream for the grace period, then hands it over.
          assert.isTrue(minutesAfterT0(problem.range.end) > 70);
          assert.isTrue(minutesAfterT0(problem.range.end) < 70.5);
        }
        assert.strictEqual((yield* byTitle(race.title))?.state, "completed");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("turns a drop during the recording into a gap and an incomplete recording", () =>
    Effect.gen(function* () {
      const { layer } = yield* withBehaviour({
        _tag: "Drop",
        afterMs: 10 * MINUTE,
        outageMs: 2 * MINUTE,
      });
      yield* Effect.gen(function* () {
        yield* advance(75, 5);
        const done = yield* only;
        assert.strictEqual(done.state, "incomplete");
        const [gap] = yield* eventsOf("RecordingGap");
        assert.strictEqual(gap?.reason, "streamDropped");
        assert.deepStrictEqual([gap!.range.start, gap!.range.end].map(minutesAfterT0), [35, 37]);
        assert.deepStrictEqual(
          done.problems.map((problem) => problem._tag),
          ["Gap"],
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("fails a recording whose source never delivers", () =>
    Effect.gen(function* () {
      const { layer } = yield* withBehaviour({ _tag: "Down" });
      yield* Effect.gen(function* () {
        yield* advance(75, 5);
        const done = yield* only;
        assert.strictEqual(done.state, "failed");
        assert.deepStrictEqual(
          done.problems.map((problem) => problem._tag),
          ["SourceUnreachable"],
        );
        const [failed] = yield* eventsOf("RecordingFailed");
        assert.strictEqual(failed?.reason, "sourceUnreachable");
        // Made by a rule: it looks for its repeat for 14 days after the programme ended.
        assert.strictEqual(
          minutesAfterT0(done.rerunUntil!) - minutesAfterT0(race.end),
          14 * 24 * 60,
        );
        const [ended] = yield* eventsOf("RecordingEnded");
        assert.strictEqual(ended?.rerun, "looking");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("marks a recording missed while the server was down, and resumes a running one", () =>
    Effect.gen(function* () {
      const missed = recording({
        id: RecordingId.make("missed"),
        state: "scheduled",
        start: at(-90),
        end: at(-30),
      });
      const interrupted = recording({
        id: RecordingId.make("interrupted"),
        state: "recording",
        start: at(-10),
        end: at(20),
      });
      const { harness, layer } = yield* makeHarness({ recordings: [missed, interrupted] });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        const all = yield* recordings;
        const byId = (id: string) => all.find((item) => item.id === id);
        assert.strictEqual(byId("missed")?.state, "failed");
        assert.strictEqual(byId("interrupted")?.state, "recording");
        assert.deepStrictEqual(harness.log.started, [url]);
        const [failed] = yield* eventsOf("RecordingFailed");
        assert.strictEqual(failed?.reason, "missed");

        yield* advance(21, 5);
        const resumed = (yield* recordings).find((item) => item.id === "interrupted");
        // The first ten minutes were lost with the server.
        assert.strictEqual(resumed?.state, "incomplete");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("cancels a recording that waits for a stream and frees its place in the queue", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ lineup: singleSource(1) });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const segments = yield* SegmentRepo;
        const first = yield* scheduler.recordRange({
          channelId: skyF1,
          title: "Boxengasse",
          start: at(0),
          end: at(30),
          ownerId: alice,
        });
        const waiting = yield* scheduler.recordRange({
          channelId: daserste,
          title: "Tagesschau",
          start: at(0),
          end: at(30),
          ownerId: bob,
        });
        yield* advance(0.5);
        // Both started; only the first got the one stream.
        assert.strictEqual((yield* byTitle("Tagesschau"))?.state, "recording");
        assert.deepStrictEqual(harness.log.started, [url]);

        const cancelled = yield* scheduler.stop(waiting.id);
        assert.strictEqual(cancelled.state, "cancelled");
        yield* scheduler.stop(first.id);
        yield* advance(30, 5);

        const active = [...harness.log.active.values()].reduce((sum, count) => sum + count, 0);
        assert.strictEqual(active, 0);
        assert.deepStrictEqual(harness.log.started, [url]);
        assert.deepStrictEqual(yield* segments.forChannel(daserste, T0, T0 + 60 * MINUTE), []);
        assert.strictEqual((yield* byTitle("Tagesschau"))?.state, "cancelled");
        assert.strictEqual((yield* byTitle("Boxengasse"))?.state, "completed");
        const ended = yield* eventsOf("RecordingEnded");
        assert.deepStrictEqual(
          ended.map((event) => [event.recordingId, event.state]),
          [
            [waiting.id, "cancelled"],
            [first.id, "completed"],
          ],
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("records a programme again after its recording was stopped", () =>
    Effect.gen(function* () {
      const training = programme(skyF1, "Training", 0, 20);
      const { harness, layer } = yield* makeHarness({ programmes: [training, tatort] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;

        // Stopped before it started: cancelled, and a new request schedules a new recording.
        const early = yield* scheduler.recordProgramme(tatort.id, { ownerId: alice });
        assert.strictEqual((yield* scheduler.stop(early.id)).state, "cancelled");
        const rescheduled = yield* scheduler.recordProgramme(tatort.id, { ownerId: alice });
        assert.notStrictEqual(rescheduled.id, early.id);
        assert.strictEqual(rescheduled.state, "scheduled");

        // Stopped while running: kept, and a new request records the rest anew.
        const running = yield* scheduler.recordProgramme(training.id, { ownerId: alice });
        yield* advance(10, 2);
        yield* scheduler.stop(running.id);
        yield* advance(0.5);
        assert.strictEqual(
          (yield* recordings).find((item) => item.id === running.id)?.state,
          "completed",
        );
        const again = yield* scheduler.recordProgramme(training.id, { ownerId: alice });
        assert.notStrictEqual(again.id, running.id);
        yield* advance(0.1);
        assert.strictEqual(
          (yield* recordings).find((item) => item.id === again.id)?.state,
          "recording",
        );
        assert.deepStrictEqual(harness.log.started, [url, url]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("records a programme again by hand after its one-off recording failed", () =>
    Effect.gen(function* () {
      const failed = recording({
        id: RecordingId.make("failed"),
        channelId: daserste,
        title: tatort.title,
        programmeId: tatort.id,
        state: "failed",
        problems: [{ _tag: "NoData" }],
        start: tatort.start,
        end: tatort.end,
      });
      const { layer } = yield* makeHarness({ programmes: [tatort], recordings: [failed] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        // A one-off recording (no series recording) never looks for a repeat by itself.
        yield* advance(0.1);
        assert.strictEqual((yield* recordings).length, 1);
        assert.isUndefined((yield* recordings)[0]?.rerunUntil);
        const again = yield* scheduler.recordProgramme(tatort.id, { ownerId: alice });
        assert.notStrictEqual(again.id, failed.id);
        assert.strictEqual(again.state, "scheduled");
        assert.strictEqual((yield* recordings).length, 2);
        // A range over the same airing is a duplicate of the new one, not of the failed one.
        const range = yield* scheduler.recordRange({
          channelId: daserste,
          title: tatort.title,
          start: tatort.start,
          end: tatort.end,
          ownerId: bob,
        });
        assert.strictEqual(range.id, again.id);
        assert.deepStrictEqual(range.ownerIds, [alice, bob]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps padding a person set while the rule re-plans and the guide moves", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ programmes: [race], rules: [f1] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const repo = yield* RecordingRepo;
        yield* advance(0.1);
        const planned = yield* only;
        assert.deepStrictEqual(planned.padding, { beforeMinutes: 5, afterMinutes: 10 });
        assert.strictEqual(planned.paddingSource, "rule");

        // What PATCH /recordings/:id with padding does.
        yield* repo.update(planned.id, (stored) => ({
          ...stored,
          padding: { beforeMinutes: 0, afterMinutes: 45 },
          paddingSource: "user",
        }));
        yield* scheduler.replan;
        yield* advance(0.1);
        assert.deepStrictEqual((yield* only).padding, { beforeMinutes: 0, afterMinutes: 45 });

        // The guide moves the programme: times follow it, the padding stays.
        yield* harness.guide.replace([{ ...race, start: at(35), end: at(65) }]);
        yield* advance(0.1);
        const moved = yield* only;
        assert.strictEqual(moved.id, planned.id);
        assert.deepStrictEqual([moved.start, moved.end].map(minutesAfterT0), [35, 65]);
        assert.deepStrictEqual(moved.padding, { beforeMinutes: 0, afterMinutes: 45 });

        // A rule edit re-plans too; the extra time a person gave still holds.
        yield* harness.rules.replace([{ ...f1, padding: { beforeMinutes: 1, afterMinutes: 1 } }]);
        yield* advance(0.1);
        assert.deepStrictEqual((yield* only).padding, { beforeMinutes: 0, afterMinutes: 45 });
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the extra time of a scheduled rule recording across re-plans", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({ programmes: [race], rules: [f1] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* advance(0.1);
        const extended = yield* scheduler.extend((yield* only).id, 30);
        assert.deepStrictEqual(extended.padding, { beforeMinutes: 5, afterMinutes: 40 });
        assert.strictEqual(extended.paddingSource, "user");
        yield* scheduler.replan;
        yield* advance(0.1);
        assert.deepStrictEqual((yield* only).padding, { beforeMinutes: 5, afterMinutes: 40 });
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("gives a programme two users' rules match both owners", () =>
    Effect.gen(function* () {
      const bobsF1 = rule(
        "bobs-f1",
        { channels: [skyF1], title: [{ _tag: "Contains", values: ["Rennen"] }] },
        { ownerId: bob },
      );
      const { harness, layer } = yield* makeHarness({ programmes: [race], rules: [f1] });
      yield* Effect.gen(function* () {
        yield* advance(0.1);
        assert.deepStrictEqual((yield* only).ownerIds, [alice]);
        // Bob's rule arrives after Alice's recording is planned: he owns it too.
        yield* harness.rules.replace([f1, bobsF1]);
        yield* advance(0.1);
        assert.deepStrictEqual((yield* only).ownerIds, [alice, bob]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps a user who left a shared recording out of it when the plan runs again", () =>
    Effect.gen(function* () {
      const bobsF1 = rule(
        "bobs-f1",
        { channels: [skyF1], title: [{ _tag: "Contains", values: ["Rennen"] }] },
        { ownerId: bob },
      );
      const { layer } = yield* makeHarness({ programmes: [race], rules: [f1, bobsF1] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const repo = yield* RecordingRepo;
        yield* advance(0.1);
        const shared = yield* only;
        assert.deepStrictEqual(shared.ownerIds, [alice, bob]);
        // Bob leaves, as the server's DELETE does for a co-owner.
        yield* repo.update(shared.id, (current) => ({
          ...current,
          ownerIds: [alice],
          declinedBy: [bob],
        }));
        yield* scheduler.replan;
        yield* advance(0.1);
        assert.deepStrictEqual((yield* only).ownerIds, [alice]);
        // Asking for it himself makes him an owner again and ends the decline.
        const again = yield* scheduler.recordProgramme(race.id, { ownerId: bob });
        assert.strictEqual(again.id, shared.id);
        assert.deepStrictEqual(again.ownerIds, [alice, bob]);
        assert.deepStrictEqual((yield* only).declinedBy, []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps a user who left a manual recording out of it despite their rule", () =>
    Effect.gen(function* () {
      const bobsTatort = rule(
        "bobs-tatort",
        { channels: [daserste], title: [{ _tag: "StartsWith", values: ["Tatort"] }] },
        { ownerId: bob },
      );
      const { harness, layer } = yield* makeHarness({ programmes: [tatort] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const repo = yield* RecordingRepo;
        const manual = yield* scheduler.recordProgramme(tatort.id, { ownerId: alice });
        yield* repo.update(manual.id, (current) => ({ ...current, declinedBy: [bob] }));
        yield* harness.rules.replace([bobsTatort]);
        yield* advance(0.1);
        const one = yield* only;
        assert.strictEqual(one.id, manual.id);
        assert.deepStrictEqual(one.ownerIds, [alice]);
        assert.isUndefined(one.ownersAddedBy);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("adds a rule's owner to a programme someone records by hand", () =>
    Effect.gen(function* () {
      const bobsTatort = rule(
        "bobs-tatort",
        { channels: [daserste], title: [{ _tag: "StartsWith", values: ["Tatort"] }] },
        { ownerId: bob },
      );
      const { harness, layer } = yield* makeHarness({ programmes: [tatort] });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const manual = yield* scheduler.recordProgramme(tatort.id, { ownerId: alice });
        yield* advance(0.1);
        yield* harness.rules.replace([bobsTatort]);
        yield* advance(0.1);
        const one = yield* only;
        assert.strictEqual(one.id, manual.id);
        assert.isUndefined(one.ruleId);
        assert.deepStrictEqual(one.ownerIds, [alice, bob]);
        // Added by the rule, so Undo after "Record series" can take exactly this back (§5.3).
        assert.deepStrictEqual(one.ownersAddedBy, { [bob]: bobsTatort.id });
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("records two manual ranges with the same title as two recordings", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({});
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const first = yield* scheduler.recordRange({
          channelId: skyF1,
          title: "Boxengasse",
          start: at(5),
          end: at(15),
          ownerId: alice,
        });
        const overlapping = yield* scheduler.recordRange({
          channelId: skyF1,
          title: "Boxengasse",
          start: at(10),
          end: at(20),
          ownerId: alice,
        });
        assert.notStrictEqual(overlapping.id, first.id);
        // The same range again is the same recording.
        const again = yield* scheduler.recordRange({
          channelId: skyF1,
          title: "Boxengasse",
          start: at(5),
          end: at(15),
          ownerId: bob,
        });
        assert.strictEqual(again.id, first.id);
        assert.deepStrictEqual(again.ownerIds, [alice, bob]);
        assert.strictEqual((yield* recordings).length, 2);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("merges repeated gaps into one problem", () =>
    Effect.gen(function* () {
      const interrupted = recording({
        id: RecordingId.make("interrupted"),
        state: "recording",
        start: at(-10),
        end: at(20),
        problems: [
          { _tag: "Gap", range: { start: at(-10), end: at(-5) } },
          { _tag: "Gap", range: { start: at(-10), end: at(-5) } },
          { _tag: "Gap", range: { start: at(-6), end: at(-4) } },
        ],
      });
      const { layer } = yield* makeHarness({ recordings: [interrupted] });
      yield* Effect.gen(function* () {
        yield* advance(21, 5);
        const done = yield* only;
        assert.strictEqual(done.state, "incomplete");
        // The ten minutes lost with the server, reported three times and found once: one gap.
        assert.deepStrictEqual(
          done.problems.map((problem) =>
            problem._tag === "NoData"
              ? [problem._tag]
              : [problem._tag, ...[problem.range.start, problem.range.end].map(minutesAfterT0)],
          ),
          [["Gap", -10, 0]],
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("fails a recording whose gaps cover its whole window", () =>
    Effect.gen(function* () {
      const lost = recording({
        id: RecordingId.make("lost"),
        state: "recording",
        start: at(-10),
        end: at(1),
        problems: [
          { _tag: "Gap", range: { start: at(-10), end: at(-2) } },
          { _tag: "Gap", range: { start: at(-3), end: at(1) } },
        ],
      });
      const { layer } = yield* makeHarness({ recordings: [lost] });
      yield* Effect.gen(function* () {
        yield* advance(2, 5);
        const done = yield* only;
        assert.strictEqual(done.state, "failed");
        assert.deepStrictEqual(
          done.problems.map((problem) => problem._tag),
          ["Gap"],
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("records a programme once when requests and a rule pass race", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({ programmes: [race], rules: [f1], slowRepo: true });
      yield* Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* Effect.all(
          [
            scheduler.recordProgramme(race.id, { ownerId: alice }),
            scheduler.recordProgramme(race.id, { ownerId: bob }),
            scheduler.replan,
          ],
          { concurrency: "unbounded" },
        );
        yield* advance(0.1);
        const one = yield* only;
        assert.strictEqual(one.programmeId, race.id);
        assert.deepStrictEqual(one.ownerIds.toSorted(), [alice, bob]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
