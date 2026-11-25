/**
 * Integration tests against real ffmpeg. A feeder ffmpeg serves a live lavfi test stream over
 * HTTP (`-listen 1`); killing the feeder simulates an upstream drop.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duration, Effect, Exit, Fiber, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { Capture, reconnectSchedule } from "../../src/capture/capture.ts";
import { FfmpegConfig, testSourceArgs } from "../../src/capture/ffmpeg.ts";
import type { CaptureEvent } from "../../src/capture/model.ts";
import { GAP_TOLERANCE_MS, livePlaylist, recordingPlaylist } from "../../src/capture/playlist.ts";
import { probe } from "../../src/capture/probe.ts";
import { runToCompletion, spawnScoped } from "../../src/capture/process.ts";
import { selfCheck } from "../../src/capture/self-check.ts";
import { type CaptureHandle, type CaptureSnapshot, startCapture } from "./handle.ts";

const available = (binary: string) => spawnSync(binary, ["-version"]).status === 0;
const hasFfmpeg = available("ffmpeg") && available("ffprobe");
if (!hasFfmpeg) {
  console.warn(
    "ffmpeg/ffprobe not on PATH: skipping capture integration tests (brew install ffmpeg)",
  );
}

/** Runs a scoped test effect with live services (real clock, real processes). */
const runTest = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect));

const freePort = Effect.callback<number>((resume) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resume(Effect.succeed(port)));
  });
});

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "slipstream-capture-test-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

/** A live test channel on `url` that lives until `scope` closes. */
const startFeeder = (url: string, scope: Scope.Scope) =>
  spawnScoped("ffmpeg", [...testSourceArgs({ realtime: true }), "-listen", "1", url]).pipe(
    Scope.provide(scope),
  );

const waitFor = (
  handle: CaptureHandle,
  predicate: (snapshot: CaptureSnapshot) => boolean,
  timeout: Duration.Input,
) =>
  Effect.gen(function* () {
    while (true) {
      const snapshot = yield* handle.snapshot;
      if (predicate(snapshot)) return snapshot;
      yield* Effect.sleep(Duration.millis(100));
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.flatMap(handle.snapshot, (snapshot) =>
          Effect.die(new Error(`timed out waiting; snapshot: ${JSON.stringify(snapshot.runs)}`)),
        ),
    }),
  );

const tagCount = (playlist: string, tag: string) =>
  playlist.split("\n").filter((line) => line === tag).length;

describe.skipIf(!hasFfmpeg)("capture with real ffmpeg", () => {
  it(
    "keeps capturing through an upstream drop: new run, recorded gap, discontinuity",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const url = `http://127.0.0.1:${yield* freePort}/live.ts`;
        const testStart = Date.now();

        const feeder1 = yield* Scope.make();
        yield* startFeeder(url, feeder1);
        const handle = yield* startCapture({
          captureId: "it-drop",
          directory: dir,
          url,
          segmentSeconds: 2,
          stallTimeoutMs: 8000,
          reconnect: reconnectSchedule({ baseMs: 200, maxMs: 1000 }),
        });
        const events: Array<CaptureEvent> = [];
        yield* Effect.forkScoped(
          Stream.runForEach(handle.events, (event) => Effect.sync(() => events.push(event))),
        );

        const before = yield* waitFor(handle, (s) => s.segments.length >= 3, "20 seconds");
        const firstRunId = before.segments[0]?.runId;

        // Drop: the upstream disappears for a while, then comes back on the same URL.
        yield* Scope.close(feeder1, Exit.void);
        yield* Effect.sleep(Duration.millis(2500));
        const feeder2 = yield* Scope.make();
        yield* startFeeder(url, feeder2);
        const after = yield* waitFor(
          handle,
          (s) => s.segments.filter((segment) => segment.runId !== firstRunId).length >= 2,
          "20 seconds",
        );
        yield* Scope.close(feeder2, Exit.void);

        const { segments } = after;
        expect(after.state).toBe("running");
        expect(segments.map((segment) => segment.sequence)).toEqual(segments.map((_, i) => i));
        const runIds = [...new Set(segments.map((segment) => segment.runId))];
        expect(runIds.length).toBeGreaterThanOrEqual(2);
        // Refused connections while the upstream was down were runs too, without segments.
        expect(after.runs.length).toBeGreaterThan(runIds.length);
        expect(after.runs.some((run) => run.segments === 0 && run.lastError !== null)).toBe(true);

        const overlaps = segments.filter((segment, i) => {
          const previous = segments[i - 1];
          return previous !== undefined && segment.startMs < previous.startMs + previous.durationMs;
        });
        expect(overlaps).toEqual([]);
        for (const segment of segments) {
          expect(segment.startMs).toBeGreaterThan(testStart - 5000);
          expect(segment.startMs).toBeLessThan(Date.now());
          // The segment ffmpeg closes on its way out after a drop can be short.
          expect(segment.durationMs).toBeGreaterThan(0);
          expect(segment.durationMs).toBeLessThan(4000);
          expect(segment.bytes).toBeGreaterThan(0);
          expect((yield* Effect.promise(() => stat(join(dir, segment.path)))).size).toBe(
            segment.bytes,
          );
        }

        // The drop is a hole in wall-clock time where the second run starts.
        const holes = segments.flatMap((segment, i) => {
          const previous = segments[i - 1];
          const holeMs =
            previous === undefined ? 0 : segment.startMs - (previous.startMs + previous.durationMs);
          return holeMs > GAP_TOLERANCE_MS ? [{ afterRunId: previous?.runId, holeMs }] : [];
        });
        expect(holes.length).toBe(runIds.length - 1);
        expect(holes[0]?.afterRunId).toBe(firstRunId);
        expect(holes[0]?.holeMs).toBeLessThan(15_000);

        expect(after.streamInfo).toMatchObject({
          container: "mpegts",
          video: [{ codec: "mpeg2video", width: 320, height: 180, fps: 25 }],
          audio: [{ codec: "mp2", sampleRate: 48000 }],
        });
        expect(after.stats?.bitrate).toBeGreaterThan(0);

        const playlist = livePlaylist(segments, { dvrWindowMs: 3_600_000 });
        expect(tagCount(playlist, "#EXT-X-DISCONTINUITY")).toBe(runIds.length - 1);
        expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:0\n");

        expect(events.some((e) => e._tag === "Reconnecting" && e.attempt >= 1)).toBe(true);
        expect(events.some((e) => e._tag === "RunEnded" && e.run.segments >= 3)).toBe(true);
      }).pipe(Effect.provide(Capture.layer), runTest),
    60_000,
  );

  it(
    "captures a finite file input to the end and stops on a clean exit",
    () =>
      Effect.gen(function* () {
        const capture = yield* Capture;
        const dir = yield* tempDir;
        yield* runToCompletion(
          "ffmpeg",
          [...testSourceArgs({ durationSeconds: 5 }), "-y", "in.ts"],
          {
            cwd: dir,
          },
        );
        const events = yield* Stream.runCollect(
          capture.run({
            captureId: "it-file",
            directory: join(dir, "capture"),
            url: join(dir, "in.ts"),
            segmentSeconds: 1,
            stopOnCleanExit: true,
          }),
        );
        const segments = events.flatMap((e) => (e._tag === "SegmentAdded" ? [e.segment] : []));
        expect(segments.length).toBeGreaterThanOrEqual(4);
        const total = segments.reduce((sum, segment) => sum + segment.durationMs, 0);
        expect(total).toBeGreaterThan(4800);
        expect(total).toBeLessThan(5200);
        expect(events.at(-1)).toMatchObject({
          _tag: "RunEnded",
          run: { endReason: "exited", exitCode: 0, segments: segments.length },
        });
        // A file is read far faster than real time: all of it lands in one contiguous run.
        const last = segments.at(-1);
        const span = (last ? last.startMs + last.durationMs : 0) - (segments[0]?.startMs ?? 0);
        // Each start and duration is rounded to the millisecond on its own.
        expect(Math.abs(span - total)).toBeLessThanOrEqual(segments.length);
        const vod = recordingPlaylist(segments, {
          fromMs: segments[0]?.startMs ?? 0,
          toMs: last ? last.startMs + last.durationMs : 0,
          complete: true,
        });
        expect(vod.split("\n").filter((line) => line.startsWith("#EXTINF"))).toHaveLength(
          segments.length,
        );
        expect(vod.endsWith("#EXT-X-ENDLIST\n")).toBe(true);
        const info = yield* probe({ url: join(dir, "capture", segments[0]?.path ?? "") });
        expect(info.video?.codec).toBe("mpeg2video");
      }).pipe(Effect.provide(Capture.layer), runTest),
    30_000,
  );

  it(
    "fails once the reconnect schedule runs out on an unreachable upstream",
    () =>
      Effect.gen(function* () {
        const capture = yield* Capture;
        const dir = yield* tempDir;
        const url = `http://127.0.0.1:${yield* freePort}/nothing.ts`;
        const events: Array<CaptureEvent> = [];
        const error = yield* capture
          .run({
            captureId: "it-down",
            directory: dir,
            url,
            reconnect: reconnectSchedule({ baseMs: 50, maxMs: 100, maxRetries: 2 }),
          })
          .pipe(
            Stream.runForEach((event) => Effect.sync(() => events.push(event))),
            Effect.flip,
          );
        expect(error._tag).toBe("CaptureFailed");
        expect(error.attempts).toBe(3);
        expect(error.lastError).toMatch(/refused/i);
        expect(events.filter((e) => e._tag === "RunEnded")).toHaveLength(3);
        expect(events.filter((e) => e._tag === "Reconnecting").map((e) => e.attempt)).toEqual([
          1, 2,
        ]);
      }).pipe(Effect.provide(Capture.layer), runTest),
    30_000,
  );

  it(
    "stops ffmpeg when the capture's scope closes",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const url = `http://127.0.0.1:${yield* freePort}/live.ts`;
        const feeder = yield* startFeeder(url, yield* Effect.scope);
        const fiber = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* startCapture({ captureId: "it-stop", directory: dir, url });
              yield* waitFor(
                handle,
                (s) => s.runs.length > 0 && s.streamInfo !== null,
                "15 seconds",
              );
              return yield* handle.snapshot;
            }),
          ),
        );
        yield* Fiber.join(fiber);
        // The feeder serves exactly one client; once the capture is gone it sees the
        // disconnect and exits on its own.
        const exit = yield* Effect.timeoutOption(feeder.exit, Duration.seconds(10));
        expect(exit._tag).toBe("Some");
      }).pipe(Effect.provide(Capture.layer), runTest),
    30_000,
  );
});

describe.skipIf(!hasFfmpeg)("process", () => {
  it("kills a running process when its scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const process = yield* spawnScoped("ffmpeg", [
        ...testSourceArgs({ realtime: true }),
        "-y",
        "/dev/null",
      ]).pipe(Scope.provide(scope));
      const isAlive = () => {
        try {
          globalThis.process.kill(process.pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      expect(isAlive()).toBe(true);
      yield* Scope.close(scope, Exit.void);
      expect(isAlive()).toBe(false);
    }).pipe(runTest));

  it("fails with BinaryNotFound for a missing binary", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(runToCompletion("slipstream-no-such-binary", []));
      expect(error._tag).toBe("BinaryNotFound");
    }).pipe(runTest));
});

describe.skipIf(!hasFfmpeg)("selfCheck and probe", () => {
  it(
    "passes on this machine's ffmpeg",
    () =>
      Effect.gen(function* () {
        const report = yield* selfCheck();
        expect(report.ffmpegVersion).toMatch(/^\d+\.\d+/);
        expect(report.segments).toBeGreaterThanOrEqual(2);
        expect(report.segmentInfo.video?.codec).toBe("mpeg2video");
        expect(report.segmentInfo.audio[0]?.codec).toBe("mp2");
      }).pipe(runTest),
    60_000,
  );

  it("fails the version step with a missing or too old ffmpeg", () =>
    Effect.gen(function* () {
      const missing = yield* Effect.flip(
        selfCheck().pipe(
          Effect.provideService(FfmpegConfig, {
            ffmpeg: "slipstream-no-ffmpeg",
            ffprobe: "ffprobe",
          }),
        ),
      );
      expect(missing).toMatchObject({ _tag: "SelfCheckFailed", step: "version" });
      const old = yield* Effect.flip(selfCheck({ minimumMajor: 999 }));
      expect(old.message).toMatch(/too old/);
    }).pipe(runTest));

  it("probes stream info from a file and reports unreadable input", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      yield* runToCompletion("ffmpeg", [...testSourceArgs({ durationSeconds: 1 }), "-y", "p.ts"], {
        cwd: dir,
      });
      const info = yield* probe({ url: join(dir, "p.ts") });
      expect(info).toMatchObject({
        container: "mpegts",
        video: { codec: "mpeg2video", width: 320, height: 180, fps: 25 },
        audio: [{ codec: "mp2", channels: 1 }],
      });
      const error = yield* Effect.flip(probe({ url: join(dir, "missing.ts") }));
      expect(error._tag).toBe("ProbeFailed");
    }).pipe(runTest));

  it("refuses local files behind file: and concat: URLs", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const file = join(dir, "local.ts");
      yield* runToCompletion("ffmpeg", [...testSourceArgs({ durationSeconds: 1 }), "-y", file]);
      for (const url of [`file://${file}`, `concat:${file}|${file}`]) {
        const error = yield* Effect.flip(probe({ url }));
        expect(error._tag).toBe("ProbeFailed");
        expect(error.message).toMatch(/not on whitelist/);
      }
    }).pipe(runTest));
});
