import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Stream tests run real ffmpeg processes for a few seconds each.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
