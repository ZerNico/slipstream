/**
 * Child processes as scoped resources, on Effect's `ChildProcessSpawner` (as the fake source's
 * ffmpeg): a process lives exactly as long as its scope, and closing the scope (normally, on
 * failure or on interrupt) stops it with SIGTERM, escalating to SIGKILL after {@link KILL_AFTER}.
 *
 * The recorder's ffmpeg helpers are plain Effects the server calls from many places, so they
 * bring Node's spawner themselves instead of asking every caller for one.
 */
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { Duration, Effect, Layer, Stream, type Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { BinaryNotFound, ProcessFailed } from "./errors.ts";

/**
 * How long a process may take to exit after SIGTERM before it gets SIGKILL. ffmpeg uses it to
 * finish the segment it is writing, which takes well under a second.
 */
export const KILL_AFTER = Duration.seconds(3);

/** How a process ended. */
export interface ProcessExit {
  /** The exit code; null when a signal ended the process. */
  readonly code: number | null;
}

/** A started process; each line stream can be consumed once. */
export interface RunningProcess {
  readonly pid: number;
  readonly stdout: Stream.Stream<string>;
  readonly stderr: Stream.Stream<string>;
  /** Completes when the process has exited. */
  readonly exit: Effect.Effect<ProcessExit>;
}

/** Options for {@link spawnScoped}. */
export interface SpawnOptions {
  readonly cwd?: string;
}

const nodeSpawner = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/** Text lines of an output pipe; a pipe that breaks ends the stream, as end of file would. */
const linesOf = <E>(bytes: Stream.Stream<Uint8Array, E>): Stream.Stream<string> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.catch(() => Stream.empty),
  );

/**
 * Starts `binary` with `args` and ties it to the current scope. On scope close a still running
 * process gets SIGTERM (ffmpeg then finishes its current segment) and SIGKILL after
 * {@link KILL_AFTER}.
 */
export const spawnScoped = (
  binary: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions = {},
): Effect.Effect<RunningProcess, BinaryNotFound, Scope.Scope> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(binary, args, {
          cwd: options.cwd,
          stdin: "ignore",
          killSignal: "SIGTERM",
          forceKillAfter: KILL_AFTER,
        }),
      )
      .pipe(Effect.mapError((error) => new BinaryNotFound({ binary, message: error.message })));
    return {
      pid: handle.pid,
      stdout: linesOf(handle.stdout),
      stderr: linesOf(handle.stderr),
      exit: handle.exitCode.pipe(
        Effect.map((code): ProcessExit => ({ code })),
        // The spawner fails `exitCode` when a signal ended the process.
        Effect.orElseSucceed((): ProcessExit => ({ code: null })),
      ),
    } satisfies RunningProcess;
  }).pipe(Effect.provide(nodeSpawner));

/** Output of a process that ran to completion. */
export interface Completed {
  readonly stdout: string;
  readonly stderr: string;
}

const STDERR_TAIL = 4000;

/**
 * Runs a short-lived process to completion and collects its output. Fails with
 * {@link ProcessFailed} on a non-zero exit, carrying the tail of stderr.
 */
export const runToCompletion = (
  binary: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions = {},
): Effect.Effect<Completed, BinaryNotFound | ProcessFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* spawnScoped(binary, args, options);
      const [stdout, stderr] = yield* Effect.all(
        [Stream.runCollect(process.stdout), Stream.runCollect(process.stderr)],
        { concurrency: 2 },
      );
      const exit = yield* process.exit;
      const result = { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
      if (exit.code !== 0) {
        return yield* new ProcessFailed({
          binary,
          exitCode: exit.code,
          stderr: result.stderr.slice(-STDERR_TAIL),
        });
      }
      return result;
    }),
  );
