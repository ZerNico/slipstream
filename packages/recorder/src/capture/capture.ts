/**
 * The capture engine: one supervised ffmpeg stream copy per channel URL, written as MPEG-TS
 * segments into a directory and indexed with wall-clock times.
 *
 * Each ffmpeg process is a run. A run ends when ffmpeg exits or stalls; the capture then starts
 * a new run. A run that fails (no segment at all, or ended sooner than `minHealthyRunMs`) is
 * retried on the reconnect schedule (exponential backoff by default), so a source that drops
 * right after every connect is asked less and less often instead of in a tight loop. Only a
 * healthy run (segments, and long enough) resets the backoff. Playlists mark run boundaries as
 * discontinuities; the capture manager reports the gaps.
 */
import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Fiber,
  Layer,
  Queue,
  Ref,
  Schedule,
  Stream,
  type Scope,
} from "effect";
import { CaptureFailed } from "./errors.ts";
import { FfmpegConfig, captureArgs, type InputOptions } from "./ffmpeg.ts";
import {
  emptyInputSummary,
  feedProgressLine,
  parseLogLine,
  summarizeInput,
} from "./ffmpeg-output.ts";
import type { CaptureEvent, CaptureRun, LogLevel } from "./model.ts";
import { spawnScoped } from "./process.ts";
import {
  indexEntry,
  initialIndexState,
  parseListLine,
  startRun,
  type IndexState,
} from "./segment-index.ts";

/** What to capture and where. */
export interface CaptureOptions extends InputOptions {
  readonly captureId: string;
  /** Directory for this capture's segments and segment lists; created when missing. */
  readonly directory: string;
  /** Target segment length in seconds. Default 6. */
  readonly segmentSeconds?: number;
  /** A run with no new segment for this long is killed. Default max(20 s, 4 segments). */
  readonly stallTimeoutMs?: number;
  /**
   * Delays between consecutive failed runs (no segment, or shorter than `minHealthyRunMs`).
   * When it ends, the capture fails. Default {@link reconnectSchedule} with its defaults
   * (forever).
   */
  readonly reconnect?: Schedule.Schedule<unknown>;
  /**
   * A run shorter than this counts as failed even when it produced segments, so the backoff
   * keeps growing while the source keeps dropping. Default 30 s. A clean exit with
   * `stopOnCleanExit` (the end of a file) is never a failure.
   */
  readonly minHealthyRunMs?: number;
  /** End the capture when ffmpeg exits cleanly (end of a file input) instead of reconnecting. */
  readonly stopOnCleanExit?: boolean;
  /** How often the segment list is checked for new lines. Default 250 ms. */
  readonly pollIntervalMs?: number;
}

/** Options for {@link reconnectSchedule}. */
export interface ReconnectOptions {
  /** First delay. Default 1 second. */
  readonly baseMs?: number;
  /** Longest delay. Default 30 seconds. */
  readonly maxMs?: number;
  /** Give up after this many retries in a row. Default: never. */
  readonly maxRetries?: number;
}

/** Exponential backoff with jitter, capped at `maxMs`, optionally limited to `maxRetries`. */
export const reconnectSchedule = (options: ReconnectOptions = {}): Schedule.Schedule<unknown> => {
  const maxMs = options.maxMs ?? 30_000;
  const backoff = Schedule.exponential(Duration.millis(options.baseMs ?? 1000), 2).pipe(
    Schedule.jittered,
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.min(duration, Duration.millis(maxMs))),
    ),
  );
  return options.maxRetries === undefined
    ? backoff
    : backoff.pipe(Schedule.upTo({ times: options.maxRetries }));
};

/** A run that produced nothing or ended too soon; the reconnect schedule decides what next. */
class RunFailed extends Data.TaggedError("RunFailed")<{
  readonly run: CaptureRun;
}> {}

const DEFAULT_MIN_HEALTHY_RUN_MS = 30_000;

interface RunOutcome {
  readonly run: CaptureRun;
  readonly cleanExit: boolean;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** Reads what was appended to a file since `offset`; a missing file reads as empty. */
const readAppended = (path: string, offset: number) =>
  Effect.promise(async () => {
    try {
      const handle = await open(path, "r");
      try {
        const { size } = await handle.stat();
        if (size <= offset) return Buffer.alloc(0);
        const buffer = Buffer.alloc(size - offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      return Buffer.alloc(0);
    }
  });

const fileSize = (path: string) =>
  Effect.promise(() =>
    stat(path).then(
      (info) => info.size,
      () => 0,
    ),
  );

const LOG_LEVELS: Record<string, LogLevel> = {
  warning: "warning",
  error: "error",
  fatal: "fatal",
  panic: "fatal",
};

interface RunContext {
  readonly options: CaptureOptions;
  readonly ffmpeg: string;
  readonly runIndex: number;
  readonly index: Ref.Ref<IndexState>;
  readonly emit: (event: CaptureEvent) => Effect.Effect<unknown>;
}

/** One ffmpeg process from spawn to exit or stall. Never fails; the outcome says how it went. */
const runOnce = (ctx: RunContext): Effect.Effect<RunOutcome, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { options, emit } = ctx;
    const segmentSeconds = options.segmentSeconds ?? 6;
    const stallTimeoutMs = options.stallTimeoutMs ?? Math.max(20_000, segmentSeconds * 4000);
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const prefix = `r${pad(ctx.runIndex, 4)}`;
    const listFile = `${prefix}.csv`;
    const runId = `${options.captureId}-${prefix}`;
    const startedAtMs = yield* Clock.currentTimeMillis;
    yield* Ref.update(ctx.index, (state) => startRun(state, runId));

    const live = {
      segments: 0,
      totalBytes: 0,
      mediaMs: 0,
      speed: null as number | null,
      lastError: null as string | null,
      lastWarning: null as string | null,
      lastSegmentAt: startedAtMs,
      listOffset: 0,
      listCarry: "",
    };
    const runRecord = (
      ended: Pick<CaptureRun, "endedAtMs" | "endReason" | "exitCode"> | null,
    ): CaptureRun => ({
      captureId: options.captureId,
      runId,
      runIndex: ctx.runIndex,
      startedAtMs,
      endedAtMs: ended?.endedAtMs ?? null,
      endReason: ended?.endReason ?? null,
      exitCode: ended?.exitCode ?? null,
      lastError: live.lastError,
      segments: live.segments,
    });
    const finish = (reason: CaptureRun["endReason"], exitCode: number | null) =>
      Effect.gen(function* () {
        const run = runRecord({
          endedAtMs: yield* Clock.currentTimeMillis,
          endReason: reason,
          exitCode,
        });
        yield* emit({ _tag: "RunEnded", run });
        return run;
      });

    yield* emit({ _tag: "RunStarted", run: runRecord(null) });

    const args = captureArgs(options, {
      segmentSeconds,
      listFile,
      segmentPattern: `${prefix}-%06d.ts`,
    });
    const spawned = yield* Effect.result(spawnScoped(ctx.ffmpeg, args, { cwd: options.directory }));
    if (spawned._tag === "Failure") {
      live.lastError = spawned.failure.message;
      return { run: yield* finish("spawn-failed", null), cleanExit: false };
    }
    const process = spawned.success;

    let summary = emptyInputSummary;
    const stderrDone = yield* Effect.forkScoped(
      Stream.runForEach(process.stderr, (line) =>
        Effect.gen(function* () {
          const log = parseLogLine(line);
          const before = summary.phase;
          summary = summarizeInput(summary, log.message);
          if (before !== "done" && summary.phase === "done") {
            yield* emit({ _tag: "StreamDetected", runId, info: summary.info });
          }
          const level = LOG_LEVELS[log.level];
          if (!level) return;
          const message = log.component ? `${log.component}: ${log.message}` : log.message;
          if (level === "warning") {
            // Broken streams repeat the same warning many times a second.
            if (message === live.lastWarning) return;
            live.lastWarning = message;
          } else {
            live.lastError = message;
          }
          yield* emit({ _tag: "Log", runId, level, message });
        }),
      ),
    );

    const progress = new Map<string, string>();
    yield* Effect.forkScoped(
      Stream.runForEach(process.stdout, (line) =>
        Effect.sync(() => {
          const report = feedProgressLine(progress, line);
          if (report?.speed !== null && report?.speed !== undefined) live.speed = report.speed;
        }),
      ),
    );

    const drainList = Effect.gen(function* () {
      const appended = yield* readAppended(join(options.directory, listFile), live.listOffset);
      if (appended.length === 0) return;
      live.listOffset += appended.length;
      const lines = (live.listCarry + appended.toString("utf8")).split("\n");
      live.listCarry = lines.pop() ?? "";
      for (const line of lines) {
        const entry = parseListLine(line);
        if (!entry) continue;
        const observedAtMs = yield* Clock.currentTimeMillis;
        const bytes = yield* fileSize(join(options.directory, entry.file));
        const indexed = yield* Ref.modify(ctx.index, (state) => {
          const result = indexEntry(state, entry, observedAtMs, bytes, entry.file);
          return [result, result.state] as const;
        });
        live.segments += 1;
        live.totalBytes += bytes;
        live.mediaMs += indexed.segment.durationMs;
        live.lastSegmentAt = observedAtMs;
        yield* emit({ _tag: "SegmentAdded", segment: indexed.segment });
        yield* emit({
          _tag: "Stats",
          stats: {
            runId,
            bitrate:
              live.mediaMs > 0 ? Math.round((live.totalBytes * 8) / (live.mediaMs / 1000)) : null,
            totalBytes: live.totalBytes,
            segments: live.segments,
            mediaMs: live.mediaMs,
            speed: live.speed,
          },
        });
      }
    });

    const watch = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(Duration.millis(pollIntervalMs));
        yield* drainList;
        const now = yield* Clock.currentTimeMillis;
        if (now - live.lastSegmentAt > stallTimeoutMs) return;
      }
    });

    const ended = yield* Effect.raceFirst(
      Effect.map(process.exit, (exit) => ({ stalled: false as const, exit })),
      Effect.as(watch, { stalled: true as const, exit: null }),
    );
    if (ended.stalled) {
      live.lastError ??= `no new segment for ${Math.round(stallTimeoutMs / 1000)} s`;
      return { run: yield* finish("stalled", null), cleanExit: false };
    }
    // ffmpeg lists its last segment on the way out; let stderr finish so lastError is complete.
    yield* drainList;
    yield* Effect.timeoutOption(Fiber.join(stderrDone), Duration.seconds(1));
    return {
      run: yield* finish("exited", ended.exit.code),
      cleanExit: ended.exit.code === 0,
    };
  });

/**
 * Runs a capture as a stream of events. Pulling the stream runs ffmpeg; interrupting it kills
 * ffmpeg. The stream ends after a clean exit when `stopOnCleanExit` is set, and fails with
 * {@link CaptureFailed} when the reconnect schedule gives up.
 */
const runCapture = (
  ffmpeg: string,
  options: CaptureOptions,
): Stream.Stream<CaptureEvent, CaptureFailed> =>
  Stream.callback<CaptureEvent, CaptureFailed>((queue) =>
    Effect.gen(function* () {
      const emit = (event: CaptureEvent) => Queue.offer(queue, event);
      yield* Effect.promise(() => mkdir(options.directory, { recursive: true }));
      const index = yield* Ref.make(initialIndexState(options.captureId, ""));
      const minHealthyRunMs = options.minHealthyRunMs ?? DEFAULT_MIN_HEALTHY_RUN_MS;
      let runIndex = 0;
      let failures = 0;
      let lastRun: CaptureRun | null = null;

      const attempt = Effect.gen(function* () {
        runIndex += 1;
        const outcome = yield* Effect.scoped(runOnce({ options, ffmpeg, runIndex, index, emit }));
        const { run } = outcome;
        lastRun = run;
        const finished = outcome.cleanExit && options.stopOnCleanExit === true;
        const lastedMs = (run.endedAtMs ?? run.startedAtMs) - run.startedAtMs;
        if (run.segments === 0 || (!finished && lastedMs < minHealthyRunMs)) {
          failures += 1;
          return yield* new RunFailed({ run });
        }
        failures = 0;
        return outcome;
      });
      const schedule = (options.reconnect ?? reconnectSchedule()).pipe(
        Schedule.tap(({ duration }) =>
          emit({
            _tag: "Reconnecting",
            afterRunId: lastRun?.runId ?? "",
            attempt: failures,
            delayMs: Duration.toMillis(duration),
          }),
        ),
      );

      while (true) {
        const outcome = yield* attempt.pipe(
          Effect.retry(schedule),
          Effect.catchTag("RunFailed", ({ run }) =>
            Effect.fail(
              new CaptureFailed({
                captureId: options.captureId,
                attempts: failures,
                lastError: run.lastError,
              }),
            ),
          ),
        );
        if (outcome.cleanExit && options.stopOnCleanExit) break;
        // A healthy run: the next one starts at once, with the backoff reset.
        yield* emit({
          _tag: "Reconnecting",
          afterRunId: outcome.run.runId,
          attempt: 0,
          delayMs: 0,
        });
      }
      yield* Queue.end(queue);
    }),
  );

/** Starts and supervises channel captures. */
export class Capture extends Context.Service<
  Capture,
  {
    /** The capture as an event stream; pulling it runs ffmpeg, interrupting it stops ffmpeg. */
    readonly run: (options: CaptureOptions) => Stream.Stream<CaptureEvent, CaptureFailed>;
  }
>()("@slipstream/recorder/Capture") {
  static readonly layer = Layer.effect(
    Capture,
    Effect.gen(function* () {
      const { ffmpeg } = yield* FfmpegConfig;
      return Capture.of({
        run: (options) => runCapture(ffmpeg, options),
      });
    }),
  );
}
