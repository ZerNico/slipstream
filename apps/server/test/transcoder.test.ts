/**
 * The transcoder's sharing and stopping, over a fake ffmpeg that waits for a gate before it
 * writes its output: one job per (segment, variant) however many ask, another variant is
 * another job, and a job nobody waits for any more is interrupted.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref } from "effect";
import { FfmpegRunner } from "@slipstream/recorder";
import { ServerConfig } from "../src/config.ts";
import { type SegmentRequest, Transcoder } from "../src/transcode/service.ts";
import { parseVariant } from "../src/transcode/variant.ts";
import { tempDir, testSettings } from "./support.ts";

interface FakeRuns {
  /** Output files of the ffmpeg runs started. */
  readonly started: Ref.Ref<ReadonlyArray<string>>;
  /** Runs that were interrupted before they finished. */
  readonly interrupted: Ref.Ref<number>;
  /** Opens to let every waiting run write its output. */
  readonly gate: Deferred.Deferred<void>;
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
          }).pipe(Effect.onInterrupt(() => Ref.update(runs.interrupted, (count) => count + 1))),
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
) =>
  Effect.gen(function* () {
    const root = yield* tempDir;
    const runs: FakeRuns = {
      started: yield* Ref.make<ReadonlyArray<string>>([]),
      interrupted: yield* Ref.make(0),
      gate: yield* Deferred.make<void>(),
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
        const viewer = { channelId: "ch", live: true };
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
});
