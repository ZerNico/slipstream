import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // HTTP round trips start a real server, and the source tests a fake source with ffmpeg.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
