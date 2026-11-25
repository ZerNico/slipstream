/**
 * Shared test helpers: temp directories and settings that point the server at them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ServerSettings } from "../src/config.ts";

/** A fresh temp directory, removed when the surrounding scope closes. */
export const tempDir = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "slipstream-server-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

/** Settings for a server whose state lives under `root`. */
export const testSettings = (
  root: string,
  overrides: Partial<ServerSettings> = {},
): ServerSettings => ({
  host: "127.0.0.1",
  port: 0,
  configDir: join(root, "config"),
  dataDir: join(root, "data"),
  publicUrl: undefined,
  trustedProxies: [],
  webDir: undefined,
  timeZone: "Europe/Berlin",
  sourceCheckIntervalMillis: 3_600_000,
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  freeSpaceFloorBytes: 0,
  advertise: false,
  startupChecks: false,
  // Short segments and grace so captures and stops settle within a test's patience.
  recorder: { segmentSeconds: 2, endGraceMs: 3000 },
  ...overrides,
});
