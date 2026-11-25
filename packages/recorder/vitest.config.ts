import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "recorder",
    include: ["test/**/*.test.ts"],
    // Integration tests run real ffmpeg captures (and against the fake source) for several seconds.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
