/**
 * Which ffmpeg Slipstream accepts and where its ffprobe lives. Plain functions without imports,
 * so `pnpm doctor` (scripts/doctor.ts) reads the same answers as the server's self-check before
 * any dependency is installed.
 */

/**
 * The oldest ffmpeg (and ffprobe) major version accepted. The capture arguments themselves are
 * older (`-stats_period` came in 4.4), but what the recorder reads back (log lines, stream
 * summaries, refused-connection messages) and the server's conversions are tested against
 * ffmpeg 8 and 9 only; the Docker image pins 9.
 */
export const MIN_FFMPEG_MAJOR = 8;

/**
 * Pulls `9.0.2` out of `ffmpeg version 9.0.2 Copyright ...` (or `n9.0.2-...` builds); null for
 * git snapshots (`N-118000-g...`), which carry no version number.
 */
export const parseVersion = (output: string): string | null => {
  const match = /^\S+ version n?(\d+(?:\.\d+)*)/m.exec(output);
  return match?.[1] ?? null;
};

/** The major version of a parsed version, `9` for `9.0.2`. */
export const majorOf = (version: string): number => Number.parseInt(version, 10);

/** `ffprobe` next to a configured `ffmpeg` (`/opt/ffmpeg/bin/ffmpeg` -> `/opt/ffmpeg/bin/ffprobe`). */
export const siblingFfprobe = (ffmpeg: string): string =>
  /ffmpeg(\.exe)?$/.test(ffmpeg) ? ffmpeg.replace(/ffmpeg(\.exe)?$/, "ffprobe$1") : "ffprobe";
