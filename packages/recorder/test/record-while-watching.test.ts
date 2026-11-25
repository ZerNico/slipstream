/**
 * "Record" while watching live: a recording of the programme on air keeps what the channel's
 * capture already holds of it, from the programme's start (minus extra time) as far back as the
 * capture reaches, not only from the moment Record was pressed. What the capture never had is
 * the recording's gap, and only that.
 */
import { assert, describe, it } from "@effect/vitest";
import { MINUTE } from "@slipstream/domain";
import { DateTime, Effect, Scope } from "effect";
import { CaptureManager } from "../src/capture-manager.ts";
import { RecordingRepo, SegmentRepo } from "../src/ports.ts";
import { paddedMs } from "../src/ranges.ts";
import { RetentionSweeper } from "../src/retention.ts";
import { Scheduler } from "../src/scheduler.ts";
import { advance, alice, makeHarness, programme, skyF1, T0 } from "./support.ts";

const minutesOf = (ms: number) => (ms - T0) / MINUTE;

describe("Recording what is being watched", () => {
  it.effect(
    "keeps the captured part before the press and reports only what was never captured",
    () =>
      Effect.gen(function* () {
        // On air since 10 minutes before the viewer tuned in (T0), until 60 minutes after.
        const race = programme(skyF1, "Live F1: Rennen", -10, 60);
        const { harness, layer } = yield* makeHarness({
          programmes: [race],
          // A short DVR window, so only the recording's range can keep the early segments.
          manager: { dvrWindowMs: 5 * MINUTE },
        });
        yield* Effect.gen(function* () {
          const manager = yield* CaptureManager;
          const segments = yield* SegmentRepo;
          const sweeper = yield* RetentionSweeper;
          const viewer = yield* Scope.make();
          // T0: the viewer tunes in, which starts the channel's capture.
          yield* manager.acquire(skyF1, { id: "sofa", kind: "live" }).pipe(Scope.provide(viewer));
          yield* advance(20, 6);

          // T1 = T0 + 20 min: Record, with 5 minutes of extra time on either side.
          const scheduler = yield* Scheduler;
          const created = yield* scheduler.recordProgramme(race.id, {
            ownerId: alice,
            padding: { beforeMinutes: 5, afterMinutes: 5 },
          });
          yield* advance(0.2, 6);
          const repo = yield* RecordingRepo;
          const running = (yield* repo.get(created.id))!;
          assert.strictEqual(running.state, "recording");
          // One capture for the channel: the recording joined the viewer's.
          assert.strictEqual(harness.log.started.length, 1);
          const range = paddedMs(running);
          assert.strictEqual(minutesOf(range.startMs), -15);

          // The viewer leaves; retention runs well past the DVR window.
          yield* Scope.close(viewer, undefined as never);
          yield* advance(10, 6);
          yield* sweeper.sweep;
          const held = yield* segments.forChannel(skyF1, range.startMs, T0 + 30 * MINUTE);
          // Every segment since T0 is still there: the first at T0, nothing lost up to now.
          assert.strictEqual(minutesOf(held[0]!.startMs), 0);
          assert.strictEqual(held.length, (30 * MINUTE) / 6000);

          // The programme ends; the recording settles.
          yield* advance(36, 6);
          const done = (yield* repo.get(created.id))!;
          assert.strictEqual(done.state, "incomplete");
          const gaps = done.problems.flatMap((problem) =>
            problem._tag === "Gap"
              ? [
                  [
                    minutesOf(DateTime.toEpochMillis(problem.range.start)),
                    minutesOf(DateTime.toEpochMillis(problem.range.end)),
                  ],
                ]
              : [],
          );
          // Missing: the extra time and the programme's first 10 minutes, before the capture ran.
          assert.deepStrictEqual(gaps, [[-15, 0]]);
          yield* sweeper.sweep;
          const kept = yield* segments.forChannel(skyF1, range.startMs, range.endMs);
          assert.strictEqual(minutesOf(kept[0]!.startMs), 0);
          assert.strictEqual(kept.length, (65 * MINUTE) / 6000);
        }).pipe(Effect.provide(layer));
      }),
  );
});
