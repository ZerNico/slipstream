/**
 * The transcoder's sharing and stopping, over a fake ffmpeg that waits for a gate before it
 * writes its output: one job per (segment, variant) however many ask, another variant is
 * another job, a job nobody waits for any more is interrupted, converting ahead never queues
 * for a job slot, and the cache sweep leaves running jobs alone. Also the loop that converts
 * new live segments ahead, which outlives a failing segment or stream.
 */
import { existsSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref, Schedule, Stream } from "effect";
import { ChannelId, RecordingId } from "@slipstream/domain";
import { FfmpegRunner } from "@slipstream/recorder";
import { ServerConfig } from "../src/config.ts";
import { keepConvertingAhead } from "../src/http/hls.ts";
import { conversionStream } from "../src/playback/service.ts";
import {
  atLiveEdge,
  conversionKey,
  liveStream,
  type SegmentRequest,
  sessionStream,
  Transcoder,
} from "../src/transcode/service.ts";
import { parseVariant } from "../src/transcode/variant.ts";
import { tempDir, testSettings } from "./support.ts";

interface FakeRuns {
  /** Output files of the ffmpeg runs started. */
  readonly started: Ref.Ref<ReadonlyArray<string>>;
  /** Runs that were interrupted before they finished. */
  readonly interrupted: Ref.Ref<number>;
  /** Opens to let every waiting run write its output. */
  readonly gate: Deferred.Deferred<void>;
  /** How long an interrupted run takes to exit (ffmpeg being killed). */
  readonly dyingMillis: number;
}

const fakeRunner = (runs: FakeRuns) =>
  Layer.succeed(FfmpegRunner, {
    run: (args, options) =>
      options?.binary === "ffprobe"
        ? Effect.succeed({ stdout: "{}", stderr: "" })
        : Effect.gen(function* () {
            const output = args.at(-1) ?? "";
            yield* Ref.update(runs.started, (list) => [...list, output]);
            yield* Deferred.await(runs.gate);
            writeFileSync(output, "converted");
            return { stdout: "", stderr: "" };
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.andThen(
                Ref.update(runs.interrupted, (count) => count + 1),
                Effect.sleep(runs.dyingMillis),
              ),
            ),
          ),
  });

const audioOnly = "copy_aac-0-2-192";
const smaller = "h264-software-vbr-2000-960-540-25000-p_aac-0-2-192";

const request = (root: string, name: string, sequence = 7): SegmentRequest => {
  const variant = parseVariant(name);
  if (variant === undefined) throw new Error(`bad variant ${name}`);
  const file = join(root, `${sequence}.ts`);
  writeFileSync(file, "original");
  return { name, variant, captureId: "cap", sequence, file };
};

/** Runs `body` with a transcoder over the fake ffmpeg in a fresh data directory. */
const withTranscoder = <A>(
  body: (transcoder: Transcoder["Service"], runs: FakeRuns, root: string) => Effect.Effect<A>,
  options: { readonly dyingMillis?: number } = {},
) =>
  Effect.gen(function* () {
    const root = yield* tempDir;
    const runs: FakeRuns = {
      started: yield* Ref.make<ReadonlyArray<string>>([]),
      interrupted: yield* Ref.make(0),
      gate: yield* Deferred.make<void>(),
      dyingMillis: options.dyingMillis ?? 0,
    };
    const layer = Transcoder.layer.pipe(
      Layer.provide(fakeRunner(runs)),
      Layer.provide(ServerConfig.layerWith(testSettings(root))),
    );
    return yield* Effect.flatMap(Transcoder, (transcoder) => body(transcoder, runs, root)).pipe(
      Effect.provide(layer),
    );
  }).pipe(Effect.scoped);

/** Waits until `count` ffmpeg runs started. */
const started = (runs: FakeRuns, count: number) =>
  Effect.gen(function* () {
    while ((yield* Ref.get(runs.started)).length < count) yield* Effect.sleep("5 millis");
  });

describe("Transcoder", () => {
  it.live("converts a segment once for two viewers of the same variant", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        const segment = request(root, audioOnly);
        const viewer = { stream: liveStream("ch"), liveEdgeOf: "ch" };
        const first = yield* Effect.forkChild(transcoder.segment(segment, viewer));
        const second = yield* Effect.forkChild(transcoder.segment(segment, viewer));
        yield* started(runs, 1);
        yield* Deferred.succeed(runs.gate, undefined);
        const [a, b] = [yield* Fiber.join(first), yield* Fiber.join(second)];
        assert.strictEqual(a, b);
        assert.isDefined(a);
        assert.lengthOf(yield* Ref.get(runs.started), 1);
        // Later viewers read the cache.
        assert.strictEqual(yield* transcoder.segment(segment, viewer), a);
        assert.lengthOf(yield* Ref.get(runs.started), 1);
      }),
    ),
  );

  it.live("converts once per variant", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        const one = yield* Effect.forkChild(
          transcoder.segment(request(root, audioOnly), undefined),
        );
        const two = yield* Effect.forkChild(transcoder.segment(request(root, smaller), undefined));
        yield* started(runs, 2);
        yield* Deferred.succeed(runs.gate, undefined);
        assert.notStrictEqual(yield* Fiber.join(one), yield* Fiber.join(two));
        assert.lengthOf(yield* Ref.get(runs.started), 2);
      }),
    ),
  );

  it.live("stops the conversion when the last viewer waiting for it leaves", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        const segment = request(root, audioOnly);
        const first = yield* Effect.forkChild(transcoder.segment(segment, undefined));
        const second = yield* Effect.forkChild(transcoder.segment(segment, undefined));
        yield* started(runs, 1);
        yield* Fiber.interrupt(first);
        yield* Effect.sleep("20 millis");
        assert.strictEqual(yield* Ref.get(runs.interrupted), 0, "one viewer still waits");
        yield* Fiber.interrupt(second);
        while ((yield* Ref.get(runs.interrupted)) === 0) yield* Effect.sleep("5 millis");
        // Asked again, it converts afresh.
        const again = yield* Effect.forkChild(transcoder.segment(segment, undefined));
        yield* started(runs, 2);
        yield* Deferred.succeed(runs.gate, undefined);
        assert.isDefined(yield* Fiber.join(again));
      }),
    ),
  );

  it.live("lets a look-ahead finish with nobody waiting", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        const segment = request(root, smaller, 8);
        yield* transcoder.warm(segment);
        yield* started(runs, 1);
        yield* Deferred.succeed(runs.gate, undefined);
        const file = yield* transcoder.segment(segment, undefined);
        assert.isDefined(file);
        assert.strictEqual(yield* Ref.get(runs.interrupted), 0);
        assert.lengthOf(yield* Ref.get(runs.started), 1);
      }),
    ),
  );

  it.live("counts picture conversions, not viewers, against the limit", () =>
    withTranscoder((transcoder) =>
      Effect.gen(function* () {
        // One per four cores in software, at least one: fill it with distinct conversions.
        let filled = 0;
        while (!(yield* transcoder.videoBusy(`ch${filled}/x`, false))) {
          yield* transcoder.touchVideo(`ch${filled}/x`);
          filled += 1;
        }
        assert.isAtLeast(filled, 1);
        // Another viewer of a conversion in use shares it; a new one is over the limit.
        assert.isFalse(yield* transcoder.videoBusy("ch0/x", false));
        assert.isTrue(yield* transcoder.videoBusy("other/x", false));
      }),
    ),
  );

  it.live("counts a recording or range of a channel apart from its live conversion", () =>
    withTranscoder((transcoder) =>
      Effect.gen(function* () {
        const live = { _tag: "Live", channelId: ChannelId.make("ch") } as const;
        const recording = { _tag: "Recording", recordingId: RecordingId.make("rec") } as const;
        // Live viewers at the edge share one conversion; anything else is its own.
        assert.strictEqual(
          conversionStream({ source: live }, "s1"),
          conversionStream({ source: live }, "s2"),
        );
        assert.notStrictEqual(
          conversionStream({ source: recording }, "s3"),
          conversionStream({ source: live }, "s1"),
        );
        assert.notStrictEqual(
          conversionStream({ source: recording }, "s3"),
          conversionStream({ source: recording }, "s4"),
        );
        // Live started behind the edge converts other segments than the live viewers'.
        assert.notStrictEqual(
          conversionStream({ source: live, startsBehindLive: true }, "s6"),
          conversionStream({ source: live }, "s1"),
        );
        // Fill the limit with the channel's live conversion and others.
        const variant = "x";
        const keys = [conversionKey(conversionStream({ source: live }, "s1"), variant)];
        let filled = 0;
        while (!(yield* transcoder.videoBusy(keys.at(-1) ?? "", false))) {
          yield* transcoder.touchVideo(keys.at(-1) ?? "");
          filled += 1;
          keys.push(conversionKey(`other${filled}`, variant));
        }
        // The same channel and variant played from a recording converts other segments.
        const fromRecording = conversionKey(conversionStream({ source: recording }, "s3"), variant);
        assert.isTrue(yield* transcoder.videoBusy(fromRecording, false));
        assert.isFalse(
          yield* transcoder.videoBusy(
            conversionKey(conversionStream({ source: live }, "s5"), variant),
            false,
          ),
        );
      }),
    ),
  );

  it.live("starts a stopping conversion afresh for a request that comes meanwhile", () =>
    withTranscoder(
      (transcoder, runs, root) =>
        Effect.gen(function* () {
          const segment = request(root, audioOnly);
          const first = yield* Effect.forkChild(transcoder.segment(segment, undefined));
          yield* started(runs, 1);
          yield* Fiber.interrupt(first);
          while ((yield* Ref.get(runs.interrupted)) === 0) yield* Effect.sleep("5 millis");
          // Its ffmpeg is still being killed: a new request does not wait for it.
          const again = yield* Effect.forkChild(transcoder.segment(segment, undefined));
          yield* started(runs, 2).pipe(Effect.timeout("150 millis"), Effect.orDie);
          yield* Deferred.succeed(runs.gate, undefined);
          assert.isDefined(yield* Fiber.join(again));
        }),
      { dyingMillis: 400 },
    ),
  );

  it.live("converts ahead only on a free job slot, never queueing before a request", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        // Every picture slot busy with segments someone waits for.
        const slots = Math.max(1, Math.floor(availableParallelism() / 4));
        const waiting = yield* Effect.forEach(
          Array.from({ length: slots }, (_, index) => request(root, smaller, 10 + index)),
          (segment) => Effect.forkChild(transcoder.segment(segment, undefined)),
        );
        yield* started(runs, slots);
        yield* transcoder.warm(request(root, smaller, 99));
        yield* Deferred.succeed(runs.gate, undefined);
        for (const fiber of waiting) assert.isDefined(yield* Fiber.join(fiber));
        yield* Effect.sleep("50 millis");
        assert.lengthOf(yield* Ref.get(runs.started), slots, "the look-ahead never ran");
        // Asked for, it converts.
        assert.isDefined(yield* transcoder.segment(request(root, smaller, 99), undefined));
      }),
    ),
  );

  it.live("stops a queued conversion when its request leaves, look-ahead or not", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        const slots = Math.max(1, Math.floor(availableParallelism() / 4));
        const busy = yield* Effect.forEach(
          Array.from({ length: slots }, (_, index) => request(root, smaller, 20 + index)),
          (segment) => Effect.forkChild(transcoder.segment(segment, undefined)),
        );
        yield* started(runs, slots);
        // Asked for, it queues for a slot; converting it ahead too changes nothing...
        const ahead = request(root, smaller, 50);
        const asked = yield* Effect.forkChild(transcoder.segment(ahead, undefined));
        yield* Effect.sleep("20 millis");
        yield* transcoder.warm(ahead);
        // ...and it stops when the request leaves before a slot frees up.
        yield* Fiber.interrupt(asked);
        yield* Deferred.succeed(runs.gate, undefined);
        for (const fiber of busy) yield* Fiber.join(fiber);
        yield* Effect.sleep("50 millis");
        assert.lengthOf(yield* Ref.get(runs.started), slots, "nobody waits for it any more");
      }),
    ),
  );

  it.live("keeps converting the live edge ahead only for viewers at the edge", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(runs.gate, undefined);
        const now = Date.now();
        assert.isTrue(atLiveEdge({ startMs: now - 12_000, durationMs: 6000 }, now));
        assert.isFalse(atLiveEdge({ startMs: now - 10 * 60_000, durationMs: 6000 }, now));
        // Paused or behind: its own conversion, and no converting ahead.
        yield* transcoder.segment(request(root, smaller, 1), {
          stream: sessionStream("behind"),
          liveEdgeOf: undefined,
        });
        assert.lengthOf(yield* transcoder.liveInUse("ch"), 0);
        yield* transcoder.segment(request(root, smaller, 2), {
          stream: liveStream("ch"),
          liveEdgeOf: "ch",
        });
        assert.lengthOf(yield* transcoder.liveInUse("ch"), 1);
      }),
    ),
  );

  it.live("leaves the directory of a starting conversion to the sweep", () =>
    withTranscoder((transcoder, runs, root) =>
      Effect.gen(function* () {
        const segment = request(root, smaller, 3);
        const pending = yield* Effect.forkChild(transcoder.segment(segment, undefined));
        // ffmpeg started but has not opened its file yet: its directory is empty.
        yield* started(runs, 1);
        yield* transcoder.sweep;
        yield* Deferred.succeed(runs.gate, undefined);
        const file = yield* Fiber.join(pending);
        assert.isDefined(file);
        // Converted and its source still there: the next sweep keeps it.
        yield* transcoder.sweep;
        assert.isTrue(existsSync(file ?? ""));
      }),
    ),
  );
});

describe("converting live segments ahead", () => {
  it.live("goes on after a segment fails", () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      yield* keepConvertingAhead(Stream.make("a", "b", "c"), (channelId) =>
        channelId === "b" ? Effect.die("database gone") : Effect.sync(() => seen.push(channelId)),
      );
      assert.deepStrictEqual(seen, ["a", "c"]);
    }),
  );

  it.live("starts again when its stream fails", () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      let subscriptions = 0;
      const indexed = Stream.unwrap(
        Effect.sync(() =>
          subscriptions++ === 0
            ? Stream.concat(Stream.make("a"), Stream.die("bus gone"))
            : Stream.make("b"),
        ),
      );
      yield* keepConvertingAhead(
        indexed,
        (channelId) => Effect.sync(() => seen.push(channelId)),
        Schedule.spaced("1 millis"),
      );
      assert.deepStrictEqual(seen, ["a", "b"]);
    }),
  );
});
