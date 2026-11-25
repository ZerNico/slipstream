/**
 * Real captures: ffmpeg against the fake source on an ephemeral port, with the manager and the
 * scheduler on the real clock. Each test ends by checking that no ffmpeg it started is left.
 */
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Capture } from "../src/capture/capture.ts";
import { ChannelId, SourceId, SourceStreamId, UserId } from "@slipstream/domain";
import { start as startFakeSource, type RunningFakeSource } from "@slipstream/fake-source";
import { DateTime, Duration, Effect, Exit, Layer, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { CaptureManager, type CaptureLease } from "../src/capture-manager.ts";
import type { RecorderEvents } from "../src/events.ts";
import {
  eventsOf,
  memoryLayer,
  type PublishedEvents,
  publishedEventsLayer,
} from "../src/memory.ts";
import { Lineup, RecordingRepo, SegmentRepo, type StreamCandidate } from "../src/ports.ts";
import { Scheduler } from "../src/scheduler.ts";

const available = (binary: string) => spawnSync(binary, ["-version"]).status === 0;
const hasFfmpeg = available("ffmpeg");
if (!hasFfmpeg) console.warn("ffmpeg not on PATH: skipping recorder integration tests");

const run = promisify(execFile);

/** ffmpeg processes started by this test process (the manager's and the fake source's). */
const ffmpegChildren = Effect.promise(async () => {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,comm="]);
  return stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, ppid, command]) => Number(ppid) === process.pid && command?.endsWith("ffmpeg"))
    .map(([pid]) => Number(pid));
});

/** Polls `check` every 200 ms until it holds, or fails after `timeout`. */
const eventually = <A, R>(
  label: string,
  check: Effect.Effect<A, never, R>,
  holds: (value: A) => boolean,
  timeout: Duration.Input = "20 seconds",
) =>
  Effect.gen(function* () {
    while (true) {
      const value = yield* check;
      if (holds(value)) return value;
      yield* Effect.sleep("200 millis");
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.flatMap(check, (value) =>
          Effect.die(new Error(`timed out waiting for ${label}: ${JSON.stringify(value)}`)),
        ),
    }),
  );

const fake = SourceId.make("fake");
const fallback = SourceId.make("fake-fallback");

const candidate = (
  source: RunningFakeSource,
  sourceId: SourceId,
  channel: string,
  query = "",
  priority = 0,
): StreamCandidate => ({
  sourceStreamId: SourceStreamId.make(`${sourceId}/${channel}${query}`),
  sourceId,
  url: `${source.url}/stream/${channel}.ts${query}`,
  priority,
});

const serienwelt = ChannelId.make("serienwelt");
const kino = ChannelId.make("kino-klassik");
const kunterbunt = ChannelId.make("kunterbunt");
const testbild = ChannelId.make("testbild-kurz");

/**
 * Runs `body` with a fake source, a temporary segment store and the recorder on real ffmpeg,
 * then closes everything and checks that no ffmpeg is left.
 */
const withRecorder = <A, E>(
  body: (
    source: RunningFakeSource,
  ) => Effect.Effect<
    A,
    E,
    | CaptureManager
    | Scheduler
    | RecorderEvents
    | PublishedEvents
    | SegmentRepo
    | RecordingRepo
    | Scope.Scope
  >,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const outer = yield* Scope.make();
      const result = yield* Effect.gen(function* () {
        const source = yield* startFakeSource({});
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "slipstream-recorder-test-"))),
          (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
        );
        const lineup = Lineup.fixed({
          channels: [
            { channelId: serienwelt, streams: [candidate(source, fake, serienwelt)] },
            { channelId: kino, streams: [candidate(source, fake, kino)] },
            {
              channelId: kunterbunt,
              streams: [candidate(source, fake, kunterbunt, "?dropAfter=5&dropMode=reset")],
            },
            {
              channelId: testbild,
              streams: [
                candidate(source, fake, testbild, "?refuse=403", 0),
                candidate(source, fallback, testbild, "", 1),
              ],
            },
          ],
          sources: [{ id: fake }, { id: fallback }],
        });
        const ports = Layer.mergeAll(memoryLayer(), lineup, publishedEventsLayer, Capture.layer);
        const manager = CaptureManager.layer({
          root,
          segmentSeconds: 1,
          reconnect: { baseMs: 200, maxMs: 1000, maxRetries: 2 },
          retryDelayMs: 500,
          preemptRetryMs: 500,
        }).pipe(Layer.provideMerge(ports));
        const recorder = Scheduler.layer({ timeZone: "Europe/Berlin", endGraceMs: 3000 }).pipe(
          Layer.provideMerge(manager),
        );
        return yield* body(source).pipe(Effect.provide(recorder), Effect.scoped);
      }).pipe(
        Scope.provide(outer),
        Effect.onExit((exit) => Scope.close(outer, exit)),
      );
      // Everything is closed: the manager's captures and the fake source's encoders.
      yield* eventually(
        "every ffmpeg to exit",
        ffmpegChildren,
        (pids) => pids.length === 0,
        "10 seconds",
      );
      return result;
    }),
  );

/** Takes a lease in a scope of its own, so the test decides when it ends. */
const lease = (channel: ChannelId, id: string, kind: "recording" | "live") =>
  Effect.gen(function* () {
    const manager = yield* CaptureManager;
    const scope = yield* Scope.make();
    const taken: CaptureLease = yield* manager
      .acquire(channel, { id, kind })
      .pipe(Scope.provide(scope), Effect.orDie);
    return { lease: taken, close: Scope.close(scope, Exit.void) };
  });

const segmentsOf = (channel: ChannelId) =>
  Effect.gen(function* () {
    const all = yield* (yield* SegmentRepo).list;
    return all.filter((segment) => segment.channelId === channel);
  });

describe.skipIf(!hasFfmpeg)("recorder with real ffmpeg and the fake source", () => {
  it("falls back from a refused stream, shares one upstream between consumers, and cleans up", () =>
    withRecorder((source) =>
      Effect.gen(function* () {
        const manager = yield* CaptureManager;
        const recording = yield* lease(testbild, "rec", "recording");
        yield* eventually(
          "segments on the fallback stream",
          segmentsOf(testbild),
          (s) => s.length >= 2,
        );
        const [refused] = yield* eventsOf("SourceRefused");
        expect(refused).toMatchObject({
          sourceId: fake,
          httpStatus: 403,
        });
        const status = (yield* manager.status).find((item) => item.channelId === testbild);
        expect(status?.stream?.sourceId).toBe(fallback);

        const viewer = yield* lease(testbild, "sofa", "live");
        yield* Effect.sleep("1500 millis");
        const sessions = yield* source.sessions.list;
        expect(sessions.map((session) => session.channelId)).toEqual([testbild]);
        // One capture ffmpeg here, one encoder in the fake source.
        expect((yield* ffmpegChildren).length).toBe(2);

        yield* recording.close;
        yield* Effect.sleep("1 second");
        expect((yield* source.sessions.list).length).toBe(1);
        yield* viewer.close;
        yield* eventually(
          "the upstream to be released",
          source.sessions.list,
          (s) => s.length === 0,
        );
        yield* eventually(
          "the capture ffmpeg to exit",
          ffmpegChildren,
          (pids) => pids.length === 0,
        );
      }),
    ));

  it("lets a recording take a live viewer's connection when the provider refuses at its limit", () =>
    withRecorder((source) =>
      Effect.gen(function* () {
        yield* source.faults.update({ maxStreams: 1, limitStatus: 509 });
        const viewer = yield* lease(serienwelt, "sofa", "live");
        yield* eventually("live segments", segmentsOf(serienwelt), (s) => s.length >= 1);

        yield* lease(kino, "rec", "recording");
        const reason = yield* viewer.lease.dropped.pipe(Effect.timeout("20 seconds"));
        expect(reason).toBe("preempted");
        yield* eventually("recorded segments", segmentsOf(kino), (s) => s.length >= 2);
        const [refused] = yield* eventsOf("SourceRefused");
        expect(refused).toMatchObject({ channelId: kino, httpStatus: 509 });
        const sessions = yield* source.sessions.list;
        expect(sessions.map((session) => session.channelId)).toEqual([kino]);
      }),
    ));

  it("records through upstream drops, reconnecting into new runs", () =>
    withRecorder(() =>
      Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const scheduled = yield* scheduler.recordRange({
          channelId: kunterbunt,
          title: "Kunterbunt am Morgen",
          start: DateTime.makeUnsafe(now + 500),
          end: DateTime.makeUnsafe(now + 14_000),
          ownerId: UserId.make("alice"),
        });
        const repo = yield* RecordingRepo;
        const done = yield* eventually(
          "the recording to finish",
          repo.get(scheduled.id),
          (recording) => recording?.state !== "scheduled" && recording?.state !== "recording",
          "40 seconds",
        );
        expect(["completed", "incomplete"]).toContain(done?.state);
        const segments = yield* segmentsOf(kunterbunt);
        // Every connection drops after 5 s, so 13.5 s of recording spans at least three runs.
        expect(new Set(segments.map((segment) => segment.runId)).size).toBeGreaterThanOrEqual(3);
        const states = (yield* eventsOf("CaptureChanged"))
          .filter((event) => event.channelId === kunterbunt)
          .map((event) => event.state);
        expect(states).toContain("reconnecting");
        // Every run is closed: stopped with the recording, or failed after its retries ran out.
        expect(["stopped", "failed"]).toContain(states.at(-1));
        expect((yield* eventsOf("RecordingStarted")).length).toBe(1);
        expect((yield* eventsOf("RecordingEnded")).map((event) => event.recordingId)).toEqual([
          scheduled.id,
        ]);
      }),
    ));
});
