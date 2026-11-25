/**
 * Reconnect backoff against a fake ffmpeg: a shell script that writes one segment, then exits
 * as if the source dropped (or, in "hold" mode, keeps running until the test releases it). Time
 * is the TestClock, so a simulated window of minutes runs in a second or two; the processes are
 * real.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, type Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { Capture, reconnectSchedule } from "../../src/capture/capture.ts";
import { FfmpegConfig } from "../../src/capture/ffmpeg.ts";
import type { CaptureEvent } from "../../src/capture/model.ts";

/** Gives up on the capture once it has spawned this many processes. */
const SPAWN_LIMIT = 40;

/**
 * Takes the segment list and pattern from the capture's arguments, writes segment 0 and its list
 * line, then fails like a dropped connection. `mode` set to `hold` keeps it running until
 * `release` exists.
 */
const script = (dir: string) => `#!/bin/sh
echo spawn >> "${dir}/spawns"
list=""
prev=""
last=""
for arg in "$@"; do
  if [ "$prev" = "-segment_list" ]; then list="$arg"; fi
  prev="$arg"
  last="$arg"
done
mode=$(cat "${dir}/mode" 2>/dev/null)
segment=$(printf "$last" 0)
printf 'ts' > "$segment"
printf '%s,0.000000,6.000000\\n' "$segment" >> "$list"
if [ "$mode" = "hold" ]; then
  while [ ! -f "${dir}/release" ]; do sleep 0.02; done
fi
echo "[in#0 @ 0x1] [error] Connection reset by peer" >&2
exit 1
`;

const fakeFfmpeg = Effect.acquireRelease(
  Effect.promise(async () => {
    const dir = await mkdtemp(join(tmpdir(), "slipstream-reconnect-test-"));
    const path = join(dir, "fake-ffmpeg");
    await writeFile(path, script(dir));
    await chmod(path, 0o755);
    await writeFile(join(dir, "mode"), "drop");
    return { dir, path };
  }),
  ({ dir }) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

/** Real time, for the processes; the TestClock does not move. */
const realSleep = (ms: number) =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** Starts the capture against the fake ffmpeg and returns what tests look at. */
const start = (fake: { readonly dir: string }) =>
  Effect.gen(function* () {
    const capture = yield* Capture;
    const events: Array<CaptureEvent> = [];
    yield* capture
      .run({
        captureId: "flaky",
        directory: join(fake.dir, "capture"),
        url: "http://flaky.test/live.ts",
        pollIntervalMs: 100,
        stallTimeoutMs: 600_000,
        reconnect: reconnectSchedule({ baseMs: 1000, maxMs: 30_000 }),
      })
      .pipe(
        Stream.runForEach((event) => Effect.sync(() => events.push(event))),
        Effect.forkScoped,
      );

    const spawns = Effect.promise(() =>
      readFile(join(fake.dir, "spawns"), "utf8").then(
        (text) => text.split("\n").filter((line) => line !== "").length,
        () => 0,
      ),
    );
    const last = () => events.at(-1);
    /** Waits (in real time) until the capture sleeps in its backoff, or has spawned too often. */
    const settled = Effect.gen(function* () {
      for (let poll = 0; poll < 500; poll += 1) {
        const event = last();
        if (event?._tag === "Reconnecting" && event.attempt >= 1) return;
        if ((yield* spawns) > SPAWN_LIMIT) return;
        yield* realSleep(5);
      }
      assert.fail(`the capture never settled; last event: ${JSON.stringify(last())}`);
    });
    const reconnects = () =>
      events.flatMap((event) => (event._tag === "Reconnecting" ? [event] : []));
    const runsEnded = () =>
      events.flatMap((event) => (event._tag === "RunEnded" ? [event.run] : []));
    const write = (name: string, text: string) =>
      Effect.promise(() => writeFile(join(fake.dir, name), text));
    const runsStarted = () => events.filter((event) => event._tag === "RunStarted").length;
    return { spawns, settled, reconnects, runsStarted, runsEnded, write };
  });

type Handle = Effect.Success<ReturnType<typeof start>>;

/** Runs `body` against a capture whose ffmpeg is the fake script. */
const withFake = <A>(body: (handle: Handle) => Effect.Effect<A, never, Scope.Scope>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* fakeFfmpeg;
      return yield* Effect.flatMap(start(fake), body).pipe(
        Effect.provide(Capture.layer),
        Effect.provideService(FfmpegConfig, { ffmpeg: fake.path, ffprobe: "ffprobe" }),
      );
    }),
  );

describe("capture reconnect backoff", () => {
  it.effect("backs off a source that drops right after its first segment", () =>
    withFake(({ spawns, settled, reconnects, runsEnded }) =>
      Effect.gen(function* () {
        yield* settled;
        // Five simulated minutes, a second at a time.
        for (let second = 0; second < 300 && (yield* spawns) <= SPAWN_LIMIT; second += 1) {
          yield* TestClock.adjust(1000);
          yield* settled;
        }
        const count = yield* spawns;
        // Delays of about 1, 2, 4, 8 and 16 s, then 30 s (each ±20 % jitter): some 15 runs.
        assert.isAtMost(count, 20, `spawned ${count} times in five minutes`);
        assert.isAtLeast(count, 10, `spawned only ${count} times in five minutes`);
        assert.isTrue(runsEnded().every((run) => run.segments === 1));
        const attempts = reconnects().map((event) => event.attempt);
        assert.deepStrictEqual(
          attempts,
          attempts.map((_, index) => index + 1),
        );
        const delays = reconnects().map((event) => event.delayMs);
        assert.isAtLeast(Math.max(...delays), 24_000);
        assert.isAtMost(Math.max(...delays), 30_000);
      }),
    ),
  );

  it.effect("resets the backoff only after a run that lasted long enough", () =>
    withFake(({ settled, reconnects, runsStarted, runsEnded, write }) =>
      Effect.gen(function* () {
        yield* settled;
        while (reconnects().length < 3) {
          yield* TestClock.adjust(1000);
          yield* settled;
        }
        assert.deepStrictEqual(
          reconnects().map((event) => event.attempt),
          [1, 2, 3],
        );

        // The next run stays up for a simulated minute.
        yield* write("mode", "hold");
        const before = runsStarted();
        while (runsStarted() === before) {
          yield* TestClock.adjust(1000);
          yield* realSleep(5);
        }
        yield* TestClock.adjust(60_000);
        yield* write("mode", "drop");
        yield* write("release", "");
        yield* settled;

        const healthy = runsEnded().at(-2);
        assert.isDefined(healthy);
        assert.isAtLeast((healthy?.endedAtMs ?? 0) - (healthy?.startedAtMs ?? 0), 60_000);
        const [reset, next] = reconnects().slice(-2);
        assert.deepStrictEqual([reset?.attempt, reset?.delayMs], [0, 0]);
        // Back to the first delay: about a second.
        assert.strictEqual(next?.attempt, 1);
        assert.isAtMost(next?.delayMs ?? Infinity, 1200);
      }),
    ),
  );
});
