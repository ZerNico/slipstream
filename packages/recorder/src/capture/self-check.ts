/**
 * Startup self-check: are ffmpeg and ffprobe there, new enough, and do the exact capture
 * arguments still produce playable segments? Run against a generated lavfi test stream so a
 * broken ffmpeg upgrade fails loudly at startup instead of silently at recording time.
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duration, Effect } from "effect";
import { SelfCheckFailed, type BinaryNotFound, type ProcessFailed } from "./errors.ts";
import { FfmpegConfig, captureArgs, testSourceArgs } from "./ffmpeg.ts";
import { majorOf, MIN_FFMPEG_MAJOR, parseVersion } from "./binaries.ts";
import type { StreamInfo } from "@slipstream/domain";
import { probe } from "./probe.ts";
import { runToCompletion } from "./process.ts";
import { parseListLine } from "./segment-index.ts";

/** What the self-check found. */
export interface SelfCheckReport {
  readonly ffmpegVersion: string;
  readonly ffprobeVersion: string;
  /** Segments the capture arguments produced from the test stream. */
  readonly segments: number;
  /** ffprobe's view of the first captured segment. */
  readonly segmentInfo: StreamInfo;
}

/** Options for {@link selfCheck}. */
export interface SelfCheckOptions {
  /** Lowest accepted ffmpeg/ffprobe major version. Default {@link MIN_FFMPEG_MAJOR}. */
  readonly minimumMajor?: number;
  /** Upper bound for the whole check. Default 60 seconds. */
  readonly timeout?: Duration.Input;
}

const describe = (error: BinaryNotFound | ProcessFailed) =>
  error._tag === "ProcessFailed"
    ? error.stderr.trim() || `exited with code ${error.exitCode}`
    : error.message;

const versionFailed = (message: string) => new SelfCheckFailed({ step: "version", message });
const captureFailed = (message: string) => new SelfCheckFailed({ step: "capture", message });

/**
 * The version the configured ffmpeg (or ffprobe) reports, e.g. "9.0.2". Fails with a
 * `version` {@link SelfCheckFailed} when it does not run or prints no version.
 */
export const ffmpegVersion = (
  which: "ffmpeg" | "ffprobe" = "ffmpeg",
): Effect.Effect<string, SelfCheckFailed> =>
  Effect.gen(function* () {
    const binary = (yield* FfmpegConfig)[which];
    const { stdout } = yield* runToCompletion(binary, ["-version"]).pipe(
      Effect.mapError((error) => versionFailed(`${binary}: ${describe(error)}`)),
      Effect.timeoutOrElse({
        duration: Duration.seconds(10),
        orElse: () => Effect.fail(versionFailed(`${binary}: -version timed out`)),
      }),
    );
    const version = parseVersion(stdout);
    if (version === null) return yield* versionFailed(`${binary}: could not read the version`);
    return version;
  });

const versionOf = (which: "ffmpeg" | "ffprobe", minimumMajor: number) =>
  Effect.gen(function* () {
    const binary = (yield* FfmpegConfig)[which];
    const version = yield* ffmpegVersion(which);
    if (majorOf(version) < minimumMajor) {
      return yield* versionFailed(
        `${binary} ${version} is too old; version ${minimumMajor} or newer is needed`,
      );
    }
    return version;
  });

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "slipstream-self-check-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

/**
 * Checks ffmpeg and ffprobe versions, then runs the capture arguments against a short lavfi
 * test stream and probes the result.
 */
export const selfCheck = (
  options: SelfCheckOptions = {},
): Effect.Effect<SelfCheckReport, SelfCheckFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const config = yield* FfmpegConfig;
      const minimumMajor = options.minimumMajor ?? MIN_FFMPEG_MAJOR;
      const ffmpeg = yield* versionOf("ffmpeg", minimumMajor);
      const ffprobeVersion = yield* versionOf("ffprobe", minimumMajor);

      const dir = yield* tempDir;
      yield* runToCompletion(
        config.ffmpeg,
        [...testSourceArgs({ durationSeconds: 4 }), "-y", "source.ts"],
        { cwd: dir },
      ).pipe(Effect.mapError((error) => captureFailed(`test stream: ${describe(error)}`)));
      yield* runToCompletion(
        config.ffmpeg,
        captureArgs(
          { url: join(dir, "source.ts") },
          { segmentSeconds: 1, listFile: "check.csv", segmentPattern: "check-%06d.ts" },
        ),
        { cwd: dir },
      ).pipe(Effect.mapError((error) => captureFailed(`capture: ${describe(error)}`)));

      const list = yield* Effect.promise(() =>
        readFile(join(dir, "check.csv"), "utf8").catch(() => ""),
      );
      const entries = list.split("\n").flatMap((line) => parseListLine(line) ?? []);
      if (entries.length < 2) {
        return yield* captureFailed(
          `capture wrote ${entries.length} segments from 4 s of test stream`,
        );
      }
      for (const entry of entries) {
        const size = yield* Effect.promise(() =>
          stat(join(dir, entry.file)).then(
            (info) => info.size,
            () => 0,
          ),
        );
        if (size === 0) return yield* captureFailed(`segment ${entry.file} is missing or empty`);
      }
      const first = entries[0];
      const segmentInfo = yield* probe({ url: join(dir, first?.file ?? "") }).pipe(
        Effect.mapError((error) => captureFailed(`probing a segment: ${error.message}`)),
      );
      if (segmentInfo.video === undefined || segmentInfo.audio.length === 0) {
        return yield* captureFailed("captured segments lost their audio or video track");
      }
      return { ffmpegVersion: ffmpeg, ffprobeVersion, segments: entries.length, segmentInfo };
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: options.timeout ?? Duration.seconds(60),
      orElse: () => Effect.fail(captureFailed("self-check timed out")),
    }),
  );
