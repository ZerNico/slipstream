import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { FakeChannel } from "./channels.ts";
import { FakeSourceConfig } from "./config.ts";
import { programmeAt } from "./schedule.ts";
import { clockTime } from "./time.ts";

/** ffmpeg could not be probed or started. */
export class FfmpegError extends Schema.TaggedError<FfmpegError>()("FfmpegError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Text files the overlay reads; the programme file is rewritten when the programme changes. */
export interface OverlayFiles {
  readonly channelFile: string;
  readonly programmeFile: string;
  /** null lets fontconfig pick its default sans font. */
  readonly fontFile: string | null;
}

/** Escapes a value for an ffmpeg filter option, then for the filtergraph around it. */
const filterValue = (raw: string) =>
  raw.replaceAll(/[\\':]/g, "\\$&").replaceAll(/[\\'[\],;]/g, "\\$&");

const drawtext = (options: Record<string, string | number>) =>
  `drawtext=${Object.entries(options)
    .map(([key, value]) => `${key}=${typeof value === "number" ? value : filterValue(value)}`)
    .join(":")}`;

/**
 * ffmpeg arguments for a channel's live stream: a lavfi test pattern and tone paced at real time
 * (`-re`), H.264 + AAC or MP2 in MPEG-TS on stdout, a keyframe every two seconds. With `overlay`,
 * a clock, the channel name and the current programme are burned in with drawtext. Interlaced
 * channels are generated at the field rate and woven into top-field-first frames.
 */
export const ffmpegArgs = (channel: FakeChannel, overlay: OverlayFiles | null): Array<string> => {
  const { video, audio } = channel;
  const sourceRate = video.interlaced ? video.frameRate * 2 : video.frameRate;
  const margin = Math.round(video.height / 27);
  const font = overlay?.fontFile ? { fontfile: overlay.fontFile } : {};
  const box = {
    fontcolor: "white",
    box: 1,
    boxcolor: "black@0.6",
    boxborderw: Math.round(margin / 3),
  };
  const filters: Array<string> = [];
  if (overlay) {
    filters.push(
      drawtext({
        ...font,
        ...box,
        text: "%{localtime:%d.%m.%Y %T}",
        fontsize: Math.round(video.height / 14),
        x: margin,
        y: margin,
      }),
      drawtext({
        ...font,
        ...box,
        textfile: overlay.channelFile,
        expansion: "none",
        fontsize: Math.round(video.height / 18),
        x: `w-tw-${margin}`,
        y: margin,
      }),
      drawtext({
        ...font,
        ...box,
        textfile: overlay.programmeFile,
        reload: sourceRate,
        expansion: "none",
        fontsize: Math.round(video.height / 20),
        line_spacing: Math.round(margin / 3),
        x: margin,
        y: `h-th-${margin}`,
      }),
    );
  }
  if (video.interlaced) filters.push("interlace=scan=tff:lowpass=complex", "setfield=tff");
  filters.push("format=yuv420p");
  const gop = String(video.frameRate * 2);
  // Roughly what IPTV providers send: 8 Mbit/s for 1080p, 4 for 720p, 2.5 for SD.
  const kbps = video.height >= 1080 ? 8000 : video.height >= 720 ? 4000 : 2500;
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-re",
    "-f",
    "lavfi",
    "-i",
    `${video.pattern}=size=${video.width}x${video.height}:rate=${sourceRate}`,
    "-re",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${audio.tone}:beep_factor=4:sample_rate=48000`,
    "-filter_complex",
    `[0:v]${filters.join(",")}[v];[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-g",
    gop,
    "-keyint_min",
    gop,
    "-sc_threshold",
    "0",
    "-b:v",
    `${kbps}k`,
    "-maxrate",
    `${kbps}k`,
    "-bufsize",
    `${kbps * 2}k`,
    ...(video.interlaced ? ["-flags", "+ildct+ilme", "-x264-params", "tff=1"] : []),
    "-aspect",
    "16:9",
    "-c:a",
    audio.codec,
    "-b:a",
    audio.codec === "mp2" ? "192k" : "128k",
    "-metadata",
    `service_name=${channel.name}`,
    "-metadata",
    "service_provider=Slipstream fake source",
    "-f",
    "mpegts",
    "pipe:1",
  ];
};

/** Fonts tried in order when none is configured: macOS, then common Linux and Alpine paths. */
const fontCandidates = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
];

/** What the installed ffmpeg can do for the overlay. */
export interface OverlaySupport {
  /** False on builds without libfreetype (Homebrew's default ffmpeg): streams have no text. */
  readonly drawtext: boolean;
  readonly fontFile: string | null;
}

/** Two lines: the programme title and its time, e.g. `16:00 - 17:15`. */
const programmeText = (channel: FakeChannel, timeZone: string, at: Date) => {
  const programme = programmeAt(channel, at, timeZone);
  if (!programme) return channel.name;
  return `${programme.title}\n${clockTime(programme.start, timeZone)} - ${clockTime(programme.stop, timeZone)}`;
};

/** Spawns and supervises the ffmpeg processes behind the streams. */
export class Ffmpeg extends Context.Service<
  Ffmpeg,
  {
    /** Probed once, on first use. */
    readonly overlaySupport: Effect.Effect<OverlaySupport, FfmpegError>;
    /**
     * Starts a channel's ffmpeg for the life of the current scope. Closing the scope stops it
     * (SIGTERM, SIGKILL after two seconds) together with the overlay files and their updater.
     */
    live(
      channel: FakeChannel,
    ): Effect.Effect<ChildProcessSpawner.ChildProcessHandle, FfmpegError, Scope.Scope>;
  }
>()("@slipstream/fake-source/Ffmpeg") {
  static readonly layer = Layer.effect(
    Ffmpeg,
    Effect.gen(function* () {
      const config = yield* FakeSourceConfig;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const findFont = Effect.gen(function* () {
        if (config.fontFile) return config.fontFile;
        for (const candidate of fontCandidates) {
          if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) return candidate;
        }
        return null;
      });

      const overlaySupport = yield* Effect.cached(
        Effect.gen(function* () {
          const filters = yield* spawner
            .string(ChildProcess.make(config.ffmpegPath, ["-hide_banner", "-filters"]))
            .pipe(
              Effect.mapError(
                (cause) => new FfmpegError({ message: `cannot run ${config.ffmpegPath}`, cause }),
              ),
            );
          const hasDrawtext = /\bdrawtext\b/.test(filters);
          if (!hasDrawtext) {
            yield* Effect.logWarning(
              `${config.ffmpegPath} has no drawtext filter (built without libfreetype): streams carry no clock or titles`,
            );
          }
          return { drawtext: hasDrawtext, fontFile: hasDrawtext ? yield* findFont : null };
        }),
      );

      const overlayFiles = Effect.fnUntraced(function* (
        channel: FakeChannel,
        fontFile: string | null,
      ) {
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "slipstream-fake-source-" });
        const channelFile = path.join(dir, "channel.txt");
        const programmeFile = path.join(dir, "programme.txt");
        const staging = path.join(dir, "programme.next");
        yield* fs.writeFileString(channelFile, channel.name);
        let shown = programmeText(channel, config.timeZone, new Date());
        yield* fs.writeFileString(programmeFile, shown);
        // drawtext rereads the file every second; rename makes each update atomic.
        yield* Effect.suspend(() => {
          const next = programmeText(channel, config.timeZone, new Date());
          if (next === shown) return Effect.void;
          shown = next;
          return fs
            .writeFileString(staging, next)
            .pipe(Effect.andThen(fs.rename(staging, programmeFile)));
        }).pipe(
          Effect.catchCause((cause) => Effect.logWarning("overlay update failed", cause)),
          Effect.repeat(Schedule.spaced("1 second")),
          Effect.forkScoped,
        );
        return { channelFile, programmeFile, fontFile };
      });

      const live = Effect.fnUntraced(function* (channel: FakeChannel) {
        const support = yield* overlaySupport;
        const overlay = support.drawtext
          ? yield* overlayFiles(channel, support.fontFile).pipe(
              Effect.mapError(
                (cause) => new FfmpegError({ message: "cannot write overlay files", cause }),
              ),
            )
          : null;
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(config.ffmpegPath, ffmpegArgs(channel, overlay), {
              stdin: "ignore",
              env: { TZ: config.timeZone },
              extendEnv: true,
              killSignal: "SIGTERM",
              forceKillAfter: "2 seconds",
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) => new FfmpegError({ message: `cannot start ${config.ffmpegPath}`, cause }),
            ),
          );
        // Drained so a chatty ffmpeg never blocks on a full stderr pipe.
        yield* handle.stderr.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) => Effect.logWarning(`ffmpeg ${channel.id}: ${line}`)),
          Effect.ignore,
          Effect.forkScoped,
        );
        return handle;
      });

      return Ffmpeg.of({ overlaySupport, live });
    }),
  );
}
