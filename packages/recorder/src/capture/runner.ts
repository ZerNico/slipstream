/**
 * One way to run short ffmpeg and ffprobe jobs (frame grabs, hardware test encodes, version
 * checks): scoped processes from `process.ts`, so a timeout or an interrupt always kills the
 * process, with the binaries from {@link FfmpegConfig}.
 */
import { Context, Duration, Effect, Layer } from "effect";
import { ProcessFailed, type BinaryNotFound } from "./errors.ts";
import { FfmpegConfig } from "./ffmpeg.ts";
import { runToCompletion, type Completed } from "./process.ts";

/** Options for one {@link FfmpegRunner} job. */
export interface RunOptions {
  /** Kill the process and fail after this long. Default 30 seconds. */
  readonly timeout?: Duration.Input;
  readonly cwd?: string;
  /** Which binary to run. Default ffmpeg. */
  readonly binary?: "ffmpeg" | "ffprobe";
}

/** Runs ffmpeg or ffprobe to completion. */
export class FfmpegRunner extends Context.Service<
  FfmpegRunner,
  {
    /**
     * Runs the binary with `args` and collects its output. Fails with `ProcessFailed` on a
     * non-zero exit or the timeout, `BinaryNotFound` when it cannot start.
     */
    run(
      args: ReadonlyArray<string>,
      options?: RunOptions,
    ): Effect.Effect<Completed, ProcessFailed | BinaryNotFound>;
  }
>()("@slipstream/recorder/FfmpegRunner") {
  /** The runner over the configured binaries. */
  static readonly layer = Layer.effect(
    FfmpegRunner,
    Effect.gen(function* () {
      const config = yield* FfmpegConfig;
      return FfmpegRunner.of({
        run: (args, options = {}) => {
          const binary = options.binary === "ffprobe" ? config.ffprobe : config.ffmpeg;
          const timeout = options.timeout ?? Duration.seconds(30);
          return runToCompletion(
            binary,
            args,
            options.cwd === undefined ? {} : { cwd: options.cwd },
          ).pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () =>
                Effect.fail(
                  new ProcessFailed({
                    binary,
                    exitCode: null,
                    stderr: `timed out after ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
                  }),
                ),
            }),
          );
        },
      });
    }),
  );
}
