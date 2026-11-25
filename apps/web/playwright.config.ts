import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end journeys against a real, running Slipstream server (web UI served by it).
 * `SLIPSTREAM_E2E_URL` points at it, e.g. `http://127.0.0.1:8787`; without it every journey is
 * skipped, so a bare `playwright test` is safe anywhere. Where the journeys must run (CI sets
 * `SLIPSTREAM_E2E_REQUIRED`), a missing server is an error, never a green run of skips.
 * Chromium only: hls.js and the player are what is exercised, and one engine keeps it short.
 */
if (
  process.env.SLIPSTREAM_E2E_REQUIRED !== undefined &&
  (process.env.SLIPSTREAM_E2E_URL === undefined ||
    process.env.SLIPSTREAM_E2E_SOURCE_URL === undefined)
) {
  throw new Error(
    "SLIPSTREAM_E2E_REQUIRED is set but SLIPSTREAM_E2E_URL or SLIPSTREAM_E2E_SOURCE_URL is not: run the journeys through `pnpm e2e`.",
  );
}

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    ...(process.env.SLIPSTREAM_E2E_URL === undefined
      ? {}
      : { baseURL: process.env.SLIPSTREAM_E2E_URL }),
    trace: "retain-on-failure",
  },
  projects: [
    {
      // The layout sweep measures boxes and CLS. A retry would hide a flaky measurement as a
      // pass, so it never retries: a flake is a bug in the screen or in the settle helpers
      // (e2e/support/layout.ts), and surfaces as one.
      name: "layout",
      testMatch: "layout-shift.spec.ts",
      // Each test seeds what it needs, so `--shard` may split this one file between tests.
      fullyParallel: true,
      retries: 0,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: "layout-shift.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
