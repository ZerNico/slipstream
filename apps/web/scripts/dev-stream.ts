import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";

/**
 * Dev only: a growing HLS EVENT playlist made by ffmpeg from its test pattern, served at
 * `/dev-stream/index.m3u8`, so the player can be tried without the server. It behaves like a
 * recording that is still running: the playlist keeps every segment and gains one every two
 * seconds, so "Watch from start", "Watch live" and seeking all have something to do.
 *
 * The first ten minutes (SLIPSTREAM_DEV_STREAM_BACKLOG seconds) are written as fast as ffmpeg
 * can, so there is a past to seek into straight away; after that it runs in real time. ffmpeg
 * stops after three hours and is killed when the dev server closes or the process exits.
 */

const ROUTE = "/dev-stream";
/** ffmpeg 9 from PATH, or the binary FFMPEG_PATH names. */
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const SEGMENT_SECONDS = 2;
const MAX_SECONDS = 3 * 60 * 60;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
};

// prettier-ignore
const ffmpegArgs = (dir: string, backlogSeconds: number) => [
  "-hide_banner", "-loglevel", "error", "-nostdin",
  "-readrate", "1", "-readrate_initial_burst", String(backlogSeconds),
  "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
  "-t", String(MAX_SECONDS),
  "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", "1500k",
  // One keyframe per segment, so every segment starts cleanly.
  "-g", "50", "-keyint_min", "50", "-sc_threshold", "0",
  "-c:a", "aac", "-b:a", "96k", "-ac", "2",
  "-f", "hls", "-hls_time", String(SEGMENT_SECONDS), "-hls_list_size", "0",
  "-hls_playlist_type", "event",
  "-hls_flags", "program_date_time+independent_segments+temp_file",
  "-hls_segment_filename", path.join(dir, "seg-%05d.ts"),
  path.join(dir, "index.m3u8"),
];

/** Starts ffmpeg writing into `dir`, and stops it with the dev server. */
const startFfmpeg = (server: ViteDevServer, dir: string, backlogSeconds: number) => {
  const logger = server.config.logger;
  const ffmpeg = spawn(FFMPEG, ffmpegArgs(dir, backlogSeconds), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  ffmpeg.on("error", (error) => {
    logger.warn(
      `[dev-stream] ffmpeg did not start (${error.message}). Live TV will show an error.`,
    );
  });
  ffmpeg.on("exit", (code, signal) => {
    if (code !== 0 && signal === null) {
      logger.warn(`[dev-stream] ffmpeg exited with code ${code}.\n${stderr.trim()}`);
    }
  });
  logger.info(`[dev-stream] test stream at ${ROUTE}/index.m3u8 (ffmpeg pid ${ffmpeg.pid})`);

  const stop = () => {
    if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) ffmpeg.kill("SIGTERM");
  };
  server.httpServer?.once("close", stop);
  process.once("exit", stop);
};

/** Serves the playlist and segments, never cached: the playlist changes every two seconds. */
const serveDir =
  (dir: string): Connect.NextHandleFunction =>
  (req, res, next) => {
    const name = path.basename(decodeURIComponent((req.url ?? "").split("?")[0] ?? ""));
    const type = CONTENT_TYPES[path.extname(name)];
    if (!type) return next();
    const file = path.join(dir, name);
    stat(file).then(
      (info) => {
        res.writeHead(200, {
          "Content-Type": type,
          "Content-Length": info.size,
          "Cache-Control": "no-store",
        });
        createReadStream(file).pipe(res);
      },
      () => {
        res.statusCode = 404;
        res.end();
      },
    );
  };

/** The Vite plugin: ffmpeg starts with `vite dev` and its output is served under /dev-stream. */
export const devStream = (): Plugin => ({
  name: "slipstream-dev-stream",
  apply: "serve",
  async configureServer(server) {
    const dir = path.resolve(server.config.root, ".data/dev-stream");
    // A fresh stream each start, so the EVENT playlist begins now.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const backlog = Number(process.env.SLIPSTREAM_DEV_STREAM_BACKLOG ?? 600);
    startFfmpeg(server, dir, Number.isFinite(backlog) && backlog >= 0 ? backlog : 600);
    server.middlewares.use(ROUTE, serveDir(dir));
  },
});
