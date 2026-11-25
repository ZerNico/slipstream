import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { CaptureManager, type ChannelEvent, type ConsumerKind } from "../src/capture-manager.ts";
import { SegmentRepo } from "../src/ports.ts";
import {
  advance,
  backup,
  daserste,
  eventsOf,
  makeHarness,
  prosieben,
  settle,
  singleSource,
  skyF1,
  stream,
  tvproxy,
  type Behaviour,
} from "./support.ts";

const url = (channel: string, source: string = tvproxy) => `http://${source}.test/${channel}.ts`;

/** Takes a lease in its own scope, so the test can drop it. */
const lease = (channel: typeof skyF1, id: string, kind: ConsumerKind, wait?: boolean) =>
  Effect.gen(function* () {
    const manager = yield* CaptureManager;
    const scope = yield* Scope.make();
    const exit = yield* manager
      .acquire(channel, { id, kind }, wait === undefined ? undefined : { wait })
      .pipe(Scope.provide(scope), Effect.exit);
    return { exit, close: Scope.close(scope, Exit.void) };
  });

const stateOf = (channel: typeof skyF1) =>
  Effect.gen(function* () {
    const manager = yield* CaptureManager;
    return (yield* manager.status).find((status) => status.channelId === channel);
  });

/** Sky F1 on tvproxy first, the backup source second. */
const twoStreams = (behaviours: Record<string, Behaviour>) =>
  makeHarness({
    lineup: {
      channels: [
        { channelId: skyF1, streams: [stream(skyF1, backup, 1), stream(skyF1, tvproxy, 0)] },
      ],
      sources: [{ id: tvproxy }, { id: backup }],
    },
    behaviours,
  });

describe("CaptureManager", () => {
  it.effect("shares one upstream per channel and stops it when the last lease is gone", () =>
    Effect.gen(function* () {
      const { harness, managerLayer } = yield* makeHarness({});
      yield* Effect.gen(function* () {
        const recording = yield* lease(skyF1, "race", "recording");
        const viewer = yield* lease(skyF1, "sofa", "live");
        yield* advance(1);
        assert.deepStrictEqual(harness.log.started, [url(skyF1)]);
        assert.strictEqual(harness.log.peak.get(url(skyF1)), 1);
        const status = yield* stateOf(skyF1);
        assert.strictEqual(status?.state, "running");
        assert.deepStrictEqual(
          status?.consumers.map((consumer) => consumer.id),
          ["race", "sofa"],
        );
        const segments = yield* (yield* SegmentRepo).list;
        assert.strictEqual(segments.length, 10);
        assert.isTrue(segments.every((segment) => segment.channelId === skyF1));

        yield* recording.close;
        yield* settle;
        assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
        yield* viewer.close;
        yield* settle;
        assert.strictEqual(harness.log.active.get(url(skyF1)), 0);
        assert.isUndefined(yield* stateOf(skyF1));
        const changes = yield* eventsOf("CaptureChanged");
        assert.deepStrictEqual(
          changes.map((event) => event.state),
          ["starting", "running", "stopped"],
        );
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("gives a live viewer no stream when the source is full, and says why", () =>
    Effect.gen(function* () {
      const { managerLayer } = yield* makeHarness({ lineup: singleSource(1) });
      yield* Effect.gen(function* () {
        yield* lease(skyF1, "race", "recording");
        const manager = yield* CaptureManager;
        const error = yield* Effect.flip(
          Effect.scoped(manager.acquire(daserste, { id: "sofa", kind: "live" })),
        );
        assert.strictEqual(error._tag, "NoStreamAvailable");
        assert.strictEqual(error.reason, "sourceLimit");
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("takes the stream of a live-only channel for a recording", () =>
    Effect.gen(function* () {
      const { harness, managerLayer } = yield* makeHarness({ lineup: singleSource(1) });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(prosieben, "sofa", "live");
        yield* advance(0.5);
        assert.strictEqual(harness.log.active.get(url(prosieben)), 1);
        assert.isTrue(Exit.isSuccess(viewer.exit));
        if (!Exit.isSuccess(viewer.exit)) return;
        const live = viewer.exit.value;

        yield* lease(skyF1, "race", "recording");
        yield* advance(0.5);
        assert.strictEqual(yield* live.dropped, "preempted");
        assert.strictEqual(harness.log.active.get(url(prosieben)), 0);
        assert.strictEqual((yield* stateOf(skyF1))?.state, "running");
        assert.isUndefined(yield* stateOf(prosieben));
        assert.deepStrictEqual(
          (yield* eventsOf("ConsumerPreempted")).map((event) => event.consumerId),
          ["sofa"],
        );
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("lets a waiting recording start as soon as a stream frees up", () =>
    Effect.gen(function* () {
      const { harness, managerLayer } = yield* makeHarness({
        lineup: singleSource(1),
        manager: { retryDelayMs: 60_000 },
      });
      yield* Effect.gen(function* () {
        const first = yield* lease(skyF1, "race", "recording");
        yield* lease(daserste, "tatort", "recording");
        yield* advance(0.5);
        const waiting = yield* stateOf(daserste);
        assert.strictEqual(waiting?.state, "failed");
        assert.isUndefined(harness.log.active.get(url(daserste)));

        yield* first.close;
        yield* advance(0.2);
        assert.strictEqual(harness.log.active.get(url(daserste)), 1);
        yield* advance(0.2);
        assert.strictEqual((yield* stateOf(daserste))?.state, "running");
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("keeps a freed stream for a waiting recording rather than a new live viewer", () =>
    Effect.gen(function* () {
      const { managerLayer } = yield* makeHarness({ lineup: singleSource(1) });
      yield* Effect.gen(function* () {
        const first = yield* lease(skyF1, "race", "recording");
        yield* lease(daserste, "tatort", "recording");
        yield* settle;
        yield* first.close;
        // The viewer asks before the waiting recording has woken up.
        const viewer = yield* lease(prosieben, "sofa", "live");
        assert.isTrue(Exit.isFailure(viewer.exit));
        yield* advance(0.2);
        assert.strictEqual((yield* stateOf(daserste))?.state, "running");
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("falls back to the next stream by priority when the source refuses", () =>
    Effect.gen(function* () {
      const { harness, managerLayer } = yield* twoStreams({
        [url(skyF1)]: { _tag: "Refuse", status: 509 },
      });
      yield* Effect.gen(function* () {
        yield* lease(skyF1, "race", "recording");
        yield* advance(0.5);
        assert.deepStrictEqual(harness.log.started, [url(skyF1), url(skyF1, backup)]);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 0);
        const status = yield* stateOf(skyF1);
        assert.strictEqual(status?.state, "running");
        assert.strictEqual(status?.stream?.sourceId, backup);
        const refused = yield* eventsOf("SourceRefused");
        assert.deepStrictEqual(
          refused.map((event) => [event.sourceId, event.httpStatus]),
          [[tvproxy, 509]],
        );
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("names every capture run from its first event, even one refused at once", () =>
    Effect.gen(function* () {
      const { managerLayer } = yield* twoStreams({
        [url(skyF1)]: { _tag: "Refuse", status: 403 },
      });
      yield* Effect.gen(function* () {
        const race = yield* lease(skyF1, "race", "recording");
        yield* advance(0.5);
        const changes = yield* eventsOf("CaptureChanged");
        const starts = changes.filter((event) => event.state === "starting");
        assert.strictEqual(starts.length, 2);
        const [refusedRun, backupRun] = starts.map((event) => event.captureId);
        assert.isDefined(refusedRun);
        assert.isDefined(backupRun);
        assert.notStrictEqual(refusedRun, backupRun);
        assert.isTrue(starts.every((event) => event.directory?.endsWith(event.captureId ?? "")));

        // The refused run: its ffmpeg line and the refusal name it.
        const logs = yield* eventsOf("CaptureLog");
        assert.deepStrictEqual(
          logs.map((event) => [event.captureId, event.level, event.message]),
          [[refusedRun, "warning", "HTTP error 403 Refused"]],
        );
        assert.deepStrictEqual(
          (yield* eventsOf("SourceRefused")).map((event) => event.captureId),
          [refusedRun],
        );

        // The working run: its state, stream and stats carry its id.
        assert.isTrue(
          changes
            .filter((event) => event.state === "running")
            .every((event) => event.captureId === backupRun),
        );
        const detected = yield* eventsOf("CaptureStreamDetected");
        assert.deepStrictEqual(
          detected.map((event) => [event.captureId, event.info.container]),
          [[backupRun, "mpegts"]],
        );
        const stats = yield* eventsOf("CaptureStats");
        assert.isTrue(stats.length >= 4);
        assert.isTrue(stats.every((event) => event.captureId === backupRun));

        yield* race.close;
        yield* settle;
        const stopped = (yield* eventsOf("CaptureChanged")).at(-1);
        assert.strictEqual(stopped?.state, "stopped");
        assert.strictEqual(stopped?.captureId, backupRun);
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("falls back when a stream stays unreachable", () =>
    Effect.gen(function* () {
      const { harness, managerLayer } = yield* twoStreams({
        [url(skyF1)]: { _tag: "Down" },
        [url(skyF1, backup)]: { _tag: "Drop", afterMs: 30_000, outageMs: 120_000 },
      });
      yield* Effect.gen(function* () {
        yield* lease(skyF1, "race", "recording");
        yield* advance(0.5);
        assert.deepStrictEqual(harness.log.started, [url(skyF1), url(skyF1, backup)]);
        assert.strictEqual((yield* stateOf(skyF1))?.stream?.sourceId, backup);
        assert.strictEqual(yield* eventsOf("SourceRefused").pipe(Effect.map((e) => e.length)), 0);
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("frees one of its own live streams when the provider refuses a recording", () =>
    Effect.gen(function* () {
      // Slipstream thinks the source is unlimited; the provider allows one connection.
      const { harness, managerLayer } = yield* makeHarness({
        behaviours: { "tvproxy.test": { _tag: "ProviderLimit", max: 1 } },
      });
      yield* Effect.gen(function* () {
        const viewer = yield* lease(prosieben, "sofa", "live");
        yield* advance(0.2);
        const live = Exit.isSuccess(viewer.exit) ? viewer.exit.value : undefined;
        yield* lease(skyF1, "race", "recording");
        yield* advance(0.5);
        assert.strictEqual(yield* live!.dropped, "preempted");
        assert.deepStrictEqual(harness.log.started, [url(prosieben), url(skyF1), url(skyF1)]);
        assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
        assert.strictEqual(harness.log.active.get(url(prosieben)), 0);
        assert.strictEqual((yield* stateOf(skyF1))?.state, "running");
        assert.strictEqual((yield* eventsOf("SourceRefused")).length, 1);
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("reports a gap with its reason after the upstream drops and comes back", () =>
    Effect.gen(function* () {
      const { managerLayer } = yield* makeHarness({
        behaviours: { [url(skyF1)]: { _tag: "Drop", afterMs: 30_000, outageMs: 20_000 } },
      });
      yield* Effect.gen(function* () {
        const taken = yield* lease(skyF1, "race", "recording");
        const recording = Exit.isSuccess(taken.exit) ? taken.exit.value : undefined;
        const seen: Array<ChannelEvent> = [];
        yield* Stream.runForEach(recording!.events, (event) =>
          Effect.sync(() => seen.push(event)),
        ).pipe(Effect.forkScoped);
        yield* advance(1.5);
        const gaps = seen.flatMap((event) => (event._tag === "Gap" ? [event] : []));
        assert.strictEqual(gaps.length, 1);
        assert.strictEqual(gaps[0]!.toMs - gaps[0]!.fromMs, 20_000);
        assert.strictEqual(gaps[0]!.reason, "streamDropped");
        assert.strictEqual(gaps[0]!.retries, 1);
      }).pipe(Effect.provide(managerLayer));
    }),
  );

  it.effect("stops every capture when the manager's scope closes", () =>
    Effect.gen(function* () {
      const { harness, managerLayer } = yield* makeHarness({});
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(managerLayer, scope);
      const started = yield* Deferred.make<void>();
      const fiber = yield* Effect.gen(function* () {
        yield* lease(skyF1, "race", "recording");
        yield* lease(daserste, "sofa", "live");
        yield* Deferred.succeed(started, undefined);
        return yield* Effect.never;
      }).pipe(Effect.provide(context), Effect.forkChild);
      yield* Deferred.await(started);
      yield* advance(0.2);
      assert.strictEqual(harness.log.active.get(url(skyF1)), 1);
      assert.strictEqual(harness.log.active.get(url(daserste)), 1);
      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(harness.log.active.get(url(skyF1)), 0);
      assert.strictEqual(harness.log.active.get(url(daserste)), 0);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("keeps live viewers' DVR windows for retention and shrinks them on request", () =>
    Effect.gen(function* () {
      const { managerLayer } = yield* makeHarness({});
      yield* Effect.gen(function* () {
        const manager = yield* CaptureManager;
        yield* lease(skyF1, "race", "recording");
        yield* lease(daserste, "sofa", "live");
        yield* advance(10, 10);
        const windows = yield* manager.liveWindows;
        assert.deepStrictEqual(
          windows.map((window) => window.channelId),
          [daserste],
        );
        const startedAt = windows[0]!.fromMs;
        yield* manager.setDvrWindow(5 * 60_000);
        const shrunk = yield* manager.liveWindows;
        assert.strictEqual(shrunk[0]!.fromMs - startedAt, 5 * 60_000);
      }).pipe(Effect.provide(managerLayer));
    }),
  );
});
