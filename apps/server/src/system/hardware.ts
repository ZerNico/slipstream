/**
 * Hardware acceleration detection (PLAN 6.11): which of ffmpeg's hardware encoders actually
 * work on this machine. `ffmpeg -encoders` only says what was compiled in, so every listed
 * encoder runs a one-second test encode per rate-control mode; only what succeeds counts.
 * Detection runs once in the background on startup; `SystemInfo.hardware` is absent until done.
 *
 * Transcoding sessions are still direct-only (see playback/service.ts); the result feeds the
 * transcode decision and the system page.
 */
import { Clock, Context, Duration, Effect, Layer, Ref } from "effect";
import type { Encoder, HardwareCaps, HardwareEncoder, RateControl } from "@slipstream/domain";
import { FfmpegRunner } from "@slipstream/recorder";
import { ServerConfig } from "../config.ts";

/** One hardware encoder ffmpeg may offer, with how to drive it. */
interface Candidate {
  readonly encoder: Exclude<Encoder, "software">;
  readonly codec: "h264" | "hevc";
  /** The ffmpeg encoder name, e.g. `h264_nvenc`. */
  readonly name: string;
}

/** Hardware encoders Slipstream knows how to use, in preference order. */
const candidates: ReadonlyArray<Candidate> = [
  { encoder: "nvenc", codec: "h264", name: "h264_nvenc" },
  { encoder: "nvenc", codec: "hevc", name: "hevc_nvenc" },
  { encoder: "qsv", codec: "h264", name: "h264_qsv" },
  { encoder: "qsv", codec: "hevc", name: "hevc_qsv" },
  { encoder: "vaapi", codec: "h264", name: "h264_vaapi" },
  { encoder: "vaapi", codec: "hevc", name: "hevc_vaapi" },
];

const rateControls: ReadonlyArray<RateControl> = ["vbr", "cbr", "cqp"];

/** The render node VAAPI uses. */
const vaapiDevice = "/dev/dri/renderD128";

/** Encoder names in `ffmpeg -encoders` output (lines like ` V....D h264_nvenc  NVIDIA ...`). */
export const parseEncoderList = (output: string): Set<string> =>
  new Set(
    output.split("\n").flatMap((line) => {
      const match = /^\s*[VAS][.A-Z]{5}\s+(\S+)/.exec(line);
      return match?.[1] === undefined ? [] : [match[1]];
    }),
  );

/** Rate-control arguments for an encoder family. */
const rateArgs = (encoder: Candidate["encoder"], mode: RateControl): Array<string> => {
  switch (encoder) {
    case "nvenc":
      return mode === "cqp"
        ? ["-rc", "constqp", "-qp", "23"]
        : ["-rc", mode, "-b:v", "4M", "-maxrate", mode === "cbr" ? "4M" : "6M"];
    case "vaapi":
      return mode === "cqp"
        ? ["-rc_mode", "CQP", "-qp", "23"]
        : ["-rc_mode", mode.toUpperCase(), "-b:v", "4M", "-maxrate", mode === "cbr" ? "4M" : "6M"];
    case "qsv":
      return mode === "cqp"
        ? ["-q:v", "23"]
        : ["-b:v", "4M", "-maxrate", mode === "cbr" ? "4M" : "6M", "-bufsize", "8M"];
  }
};

/** The ffmpeg arguments for a one-second test encode of a generated 720p picture. */
export const testEncodeArgs = (candidate: Candidate, mode: RateControl): Array<string> => {
  const source = ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25", "-t", "1"];
  const device =
    candidate.encoder === "vaapi"
      ? ["-vaapi_device", vaapiDevice]
      : candidate.encoder === "qsv"
        ? ["-init_hw_device", "qsv=hw", "-filter_hw_device", "hw"]
        : [];
  const upload =
    candidate.encoder === "vaapi"
      ? ["-vf", "format=nv12,hwupload"]
      : candidate.encoder === "qsv"
        ? ["-vf", "format=nv12,hwupload=extra_hw_frames=16"]
        : [];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...device,
    ...source,
    ...upload,
    "-c:v",
    candidate.name,
    ...rateArgs(candidate.encoder, mode),
    "-f",
    "null",
    "-",
  ];
};

/** Groups working (encoder, codec, mode) triples by encoder family, in preference order. */
export const summarise = (
  working: ReadonlyArray<{
    readonly candidate: Candidate;
    readonly modes: ReadonlyArray<RateControl>;
  }>,
): HardwareCaps => {
  const families: Array<HardwareEncoder> = [];
  for (const { candidate, modes } of working) {
    if (modes.length === 0) continue;
    const known = families.find((family) => family.encoder === candidate.encoder);
    if (known === undefined) {
      families.push({ encoder: candidate.encoder, codecs: [candidate.codec], rateControl: modes });
    } else {
      families[families.indexOf(known)] = {
        encoder: known.encoder,
        codecs: [...new Set([...known.codecs, candidate.codec])],
        rateControl: [...new Set([...known.rateControl, ...modes])],
      };
    }
  }
  return { encoders: families };
};

/** Lists ffmpeg's hardware encoders and test-encodes with each. */
export const detectHardware: Effect.Effect<HardwareCaps, never, FfmpegRunner> = Effect.gen(
  function* () {
    const ffmpeg = yield* FfmpegRunner;
    const listed = yield* ffmpeg
      .run(["-hide_banner", "-encoders"], { timeout: Duration.seconds(10) })
      .pipe(
        Effect.map(({ stdout }) => parseEncoderList(stdout)),
        Effect.orElseSucceed(() => new Set<string>()),
      );
    const working = yield* Effect.forEach(
      candidates.filter((candidate) => listed.has(candidate.name)),
      (candidate) =>
        Effect.map(
          Effect.filter(rateControls, (mode) =>
            ffmpeg.run(testEncodeArgs(candidate, mode), { timeout: Duration.seconds(15) }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          ),
          (modes) => ({ candidate, modes }),
        ),
    );
    return summarise(working);
  },
);

/** The hardware detection result, once startup detection has run. */
export class Hardware extends Context.Service<
  Hardware,
  {
    readonly caps: Effect.Effect<HardwareCaps | undefined>;
    /** When detection finished, epoch ms; absent until then. */
    readonly detectedAt: Effect.Effect<number | undefined>;
  }
>()("@slipstream/server/Hardware") {
  /** Detects in the background on startup unless `startupChecks` is off. */
  static readonly layer = Layer.effect(
    Hardware,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const runner = yield* FfmpegRunner;
      const caps = yield* Ref.make<HardwareCaps | undefined>(undefined);
      const detectedAt = yield* Ref.make<number | undefined>(undefined);
      if (config.startupChecks) {
        yield* detectHardware.pipe(
          Effect.provideService(FfmpegRunner, runner),
          Effect.tap((found) => Ref.set(caps, found)),
          Effect.tap(() =>
            Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(detectedAt, now)),
          ),
          Effect.tap((found) =>
            Effect.logInfo("Hardware encoders detected").pipe(
              Effect.annotateLogs({
                encoders: found.encoders.map((encoder) => encoder.encoder).join(",") || "none",
              }),
            ),
          ),
          Effect.forkScoped,
        );
      }
      return Hardware.of({ caps: Ref.get(caps), detectedAt: Ref.get(detectedAt) });
    }),
  );
}
