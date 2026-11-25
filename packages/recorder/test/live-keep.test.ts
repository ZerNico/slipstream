/**
 * Live TV that waits for its viewers: a channel keeps running for a while after its last live
 * viewer left, gives its stream to anyone who needs one, and its rewind buffer stays for a while
 * after it stopped (within the DVR window, and only while the disk allows).
 */
import { assert, describe, it } from "@effect/vitest";
import { MINUTE, RecordingId } from "@slipstream/domain";
import { Effect, Exit, Scope } from "effect";
import { CaptureManager, type ConsumerKind } from "../src/capture-manager.ts";
import { DiskGuard } from "../src/disk-guard.ts";
import { SegmentRepo } from "../src/ports.ts";
import { RetentionSweeper } from "../src/retention.ts";
import {
  advance,
  at,
  daserste,
  eventsOf,
  makeHarness,
  programme,
  prosieben,
  recording,
  settle,
  singleSource,
  skyF1,
  T0,
  tvproxy,
} from "./support.ts";

const url = (channel: string) => `http://${tvproxy}.test/${channel}.ts`;

/** Takes a lease in its own scope, so the test can drop it. */
const lease = (channel: typeof skyF1, id: string, kind: ConsumerKind, wait?: boolean) =>
  Effect.gen(function* () {
    const manager = yield* CaptureManager;
    const scope = yield* Scope.make();
    const exit = yield* manager
      .acquire(channel, { id, kind }, wait === undefined ? undefined : { wait })
      .pipe(Scope.provide(scope), Effect.exit);
    return { exit, close: Effect.andThen(Scope.close(scope, Exit.void), settle) };
  });

const statusOf = (channel: typeof skyF1) =>
  Effect.gen(function* () {
    const manager = yield* CaptureManager;
    return (yield* manager.status).find((status) => status.channelId === channel);
  });

const windowsOf = (channel: typeof skyF1) =>
  Effect.gen(function* () {
    const manager = yield* CaptureManager;
    return (yield* manager.liveWindows).filter((window) => window.channelId === channel);
  });

const segmentsOf = (channel: typeof skyF1) =>
  Effect.gen(function* () {
    const all = yield* (yield* SegmentRepo).list;
    return all.filter((segment) => segment.channelId === channel);
  });

const sweep = Effect.gen(function* () {
  yield* (yield* RetentionSweeper).sweep;
});

const keep = { keepRunning: 10, keepBufferMinutes: 60 } as const;

describe("live TV that waits", () => {
  it.effect("keeps the channel running after the last viewer left, then stops it", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ liveKeep: keep });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(5, 30);
        yield* viewer.close;

        const lingering = yield* statusOf(skyF1);
        assert.deepStrictEqual(lingering?.consumers, []);
        assert.strictEqual(lingering?.lingeringUntilMs, T0 + 15 * MINUTE);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
        assert.deepStrictEqual(yield* windowsOf(skyF1), [{ channelId: skyF1, fromMs: T0 }]);

        yield* advance(9.5, 30);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
        assert.strictEqual((yield* statusOf(skyF1))?.state, "running");

        yield* advance(1, 30);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 0);
        assert.isUndefined(yield* statusOf(skyF1));
        assert.deepStrictEqual(
          (yield* eventsOf("CaptureChanged")).map((event) => event.state),
          ["starting", "running", "stopped"],
        );
        // What it captured stays rewindable, up to where it stopped.
        assert.deepStrictEqual(yield* windowsOf(skyF1), [
          { channelId: skyF1, fromMs: T0, toMs: T0 + 15 * MINUTE },
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the capture for a viewer who comes back while it lingers", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ liveKeep: keep });
      yield* Effect.gen(function* () {
        const first = yield* lease(skyF1, "sofa", "live");
        yield* advance(2, 30);
        yield* first.close;
        yield* advance(3, 30);
        yield* lease(skyF1, "sofa-again", "live");
        // Past the first viewer's deadline: still the same capture.
        yield* advance(20, 30);
        assert.deepStrictEqual(harness.log.started, [url(skyF1)]);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
        assert.isUndefined((yield* statusOf(skyF1))?.lingeringUntilMs);
        assert.lengthOf(yield* segmentsOf(skyF1), 250);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the channel until the programme on air ends", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({
        liveKeep: { keepRunning: "programmeEnd", keepBufferMinutes: 60 },
        programmes: [programme(skyF1, "Qualifying", -30, 25)],
      });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(5, 30);
        yield* viewer.close;
        assert.strictEqual((yield* statusOf(skyF1))?.lingeringUntilMs, T0 + 25 * MINUTE);
        yield* advance(19.5, 30);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
        yield* advance(1, 30);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("gives a lingering channel's stream to a recording at once", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ liveKeep: keep, lineup: singleSource(1) });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(prosieben, "sofa", "live");
        yield* advance(5, 30);
        yield* viewer.close;
        assert.strictEqual(harness.log.active.get(url(prosieben)), 1);

        const race = yield* lease(skyF1, "race", "recording");
        assert.isTrue(Exit.isSuccess(race.exit));
        yield* advance(0.5);
        assert.strictEqual(harness.log.active.get(url(prosieben)), 0);
        assert.isUndefined(yield* statusOf(prosieben));
        assert.strictEqual((yield* statusOf(skyF1))?.state, "running");
        // Nobody watched it any more: no one lost a stream.
        assert.deepStrictEqual(yield* eventsOf("ConsumerPreempted"), []);
        // Its buffer is kept all the same.
        assert.deepStrictEqual(yield* windowsOf(prosieben), [
          { channelId: prosieben, fromMs: T0, toMs: T0 + 5 * MINUTE },
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("gives a lingering channel's stream to a viewer of another channel", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ liveKeep: keep, lineup: singleSource(1) });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(prosieben, "sofa", "live");
        yield* advance(1, 30);
        yield* viewer.close;

        const kitchen = yield* lease(daserste, "kitchen", "live", false);
        assert.isTrue(Exit.isSuccess(kitchen.exit));
        yield* advance(0.5);
        assert.strictEqual(harness.log.active.get(url(prosieben)), 0);
        assert.strictEqual(harness.log.active.get(url(daserste)), 1);

        // A watched channel still never gives way to another viewer.
        const other = yield* lease(skyF1, "bedroom", "live", false);
        assert.isTrue(Exit.isFailure(other.exit));
        assert.strictEqual(harness.log.active.get(url(daserste)), 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the rewind buffer after the capture stopped, then lets it go", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({ liveKeep: keep });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(5, 30);
        yield* viewer.close;
        // Lingers 10 minutes, then stops at T0 + 15 min.
        yield* advance(11, 30);
        assert.isUndefined(yield* statusOf(skyF1));
        const captured = (yield* segmentsOf(skyF1)).length;
        assert.isAtLeast(captured, 149);

        yield* advance(58, 60);
        yield* sweep;
        assert.lengthOf(yield* segmentsOf(skyF1), captured);

        yield* advance(2, 60);
        yield* sweep;
        assert.lengthOf(yield* segmentsOf(skyF1), 0);
        assert.deepStrictEqual(yield* windowsOf(skyF1), []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("rewinds into the kept buffer across the gap when a viewer comes back", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ liveKeep: { ...keep, keepRunning: 1 } });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(5, 30);
        yield* viewer.close;
        // Stopped at T0 + 6 min; back at T0 + 30 min.
        yield* advance(24, 30);
        assert.isUndefined(yield* statusOf(skyF1));
        yield* lease(skyF1, "sofa", "live");
        yield* advance(5, 30);
        assert.lengthOf(harness.log.started, 2);
        // The new capture's DVR window reaches back over the gap into the old one...
        assert.deepStrictEqual(yield* windowsOf(skyF1), [{ channelId: skyF1, fromMs: T0 }]);
        // ...and keeps it for as long as the viewer stays, past the buffer's own hour.
        yield* advance(60, 60);
        yield* sweep;
        const kept = yield* segmentsOf(skyF1);
        assert.strictEqual(kept[0]?.startMs, T0);
        const gap = kept.find((segment, index) => {
          const next = kept[index + 1];
          return next !== undefined && next.startMs - (segment.startMs + segment.durationMs) > 0;
        });
        assert.isDefined(gap);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the buffer only within the DVR window", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({
        liveKeep: { keepRunning: 1, keepBufferMinutes: 24 * 60 },
        manager: { dvrWindowMs: 30 * MINUTE },
      });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(20, 60);
        yield* viewer.close;
        yield* advance(2, 30);
        assert.isUndefined(yield* statusOf(skyF1));
        // Twenty minutes later only the last ten captured minutes are inside the window.
        yield* advance(20, 60);
        yield* sweep;
        const kept = yield* segmentsOf(skyF1);
        assert.isAbove(kept.length, 0);
        assert.isTrue(
          kept.every((segment) => segment.startMs + segment.durationMs > T0 + 12 * MINUTE),
        );
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the rewind buffer when a recording keeps the capture past the linger", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ liveKeep: keep });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(5, 30);
        // A two-hour recording joins the capture the viewer started.
        yield* lease(skyF1, "race", "recording");
        yield* advance(5, 30);
        yield* viewer.close;
        // The linger ends at T0 + 20 min; the recording keeps the capture running.
        yield* advance(15, 30);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
        // What the viewer could rewind stays as the channel's kept buffer.
        assert.deepStrictEqual(yield* windowsOf(skyF1), [
          { channelId: skyF1, fromMs: T0, toMs: T0 + 20 * MINUTE },
        ]);
        yield* sweep;
        // Back 30 minutes after leaving: the whole buffer is still there.
        yield* advance(15, 30);
        yield* lease(skyF1, "sofa-again", "live");
        assert.deepStrictEqual(yield* windowsOf(skyF1), [{ channelId: skyF1, fromMs: T0 }]);
        yield* sweep;
        assert.strictEqual((yield* segmentsOf(skyF1))[0]?.startMs, T0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("releases a viewer and stops the channel when the keep rules cannot be read", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({ liveKeepFails: true });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        assert.isTrue(Exit.isSuccess(viewer.exit));
        yield* advance(2, 30);
        yield* viewer.close;
        // The viewer is gone; the defaults (10 minutes running) apply.
        assert.deepStrictEqual((yield* statusOf(skyF1))?.consumers, []);
        assert.isAbove(yield* windowsOf(skyF1).pipe(Effect.map((windows) => windows.length)), 0);
        yield* advance(11, 30);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 0);
        assert.isUndefined(yield* statusOf(skyF1));
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("releases a viewer when the programme on air cannot be read", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness({
        liveKeep: { keepRunning: "programmeEnd", keepBufferMinutes: 60 },
        guideFails: true,
      });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(2, 30);
        yield* viewer.close;
        // No programme known: the default ten minutes.
        const status = yield* statusOf(skyF1);
        assert.deepStrictEqual(status?.consumers, []);
        assert.strictEqual(status?.lingeringUntilMs, T0 + 12 * MINUTE);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "keeps nothing of a channel an admin stopped, and forgets the stop for a new viewer",
    () =>
      Effect.gen(function* () {
        const { harness, layer } = yield* makeHarness({ liveKeep: keep });
        yield* Effect.gen(function* () {
          const manager = yield* CaptureManager;
          const viewer = yield* lease(skyF1, "sofa", "live");
          yield* advance(5, 30);
          yield* viewer.close;
          // Lingering; an admin stops it to free the stream.
          yield* manager.stopWhenIdle(skyF1);
          yield* settle;
          assert.strictEqual(harness.log.active.get(url(skyF1)), 0);
          assert.deepStrictEqual(yield* windowsOf(skyF1), []);

          // A capture an admin asked to stop, then someone watches again: it lingers as usual.
          const recorder = yield* lease(prosieben, "race", "recording");
          yield* manager.stopWhenIdle(prosieben);
          const back = yield* lease(prosieben, "sofa", "live");
          yield* advance(1, 30);
          yield* back.close;
          yield* recorder.close;
          assert.isDefined((yield* statusOf(prosieben))?.lingeringUntilMs);
          assert.strictEqual(harness.log.active.get(url(prosieben)), 1);
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("drops rewind buffers before recordings when disk space runs low", () =>
    Effect.gen(function* () {
      const { harness, layer } = yield* makeHarness({
        liveKeep: { keepRunning: 1, keepBufferMinutes: 60 },
        freeBytes: 10_000_000,
        manager: { dvrWindowMs: 60 * MINUTE },
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
        const viewer = yield* lease(daserste, "sofa", "live");
        yield* advance(10, 30);
        yield* viewer.close;
        yield* advance(2, 30);
        assert.isUndefined(yield* statusOf(daserste));
        assert.isAtLeast((yield* segmentsOf(daserste)).length, 109);
        const recorded = (yield* segmentsOf(skyF1)).length;

        const guard = yield* DiskGuard;
        yield* harness.storage.setFreeBytes(0);
        const status = yield* guard.check;
        // The buffer's files were enough: no window shrank, no recording lost a second.
        assert.strictEqual(status._tag, "Ok");
        assert.lengthOf(yield* segmentsOf(daserste), 0);
        assert.lengthOf(yield* segmentsOf(skyF1), recorded);
        assert.strictEqual(yield* (yield* CaptureManager).dvrWindowMs, 60 * MINUTE);
        assert.deepStrictEqual(yield* windowsOf(daserste), []);
      }).pipe(
        Effect.provide(DiskGuard.layer({ floorBytes: 50_000, intervalMs: 3_600_000 })),
        Effect.provide(layer),
      );
    }),
  );
});
