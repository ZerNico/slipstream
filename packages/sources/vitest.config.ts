import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The large-guide test collects garbage before each heap sample, so it measures what the
    // parser retains rather than when the collector happened to run.
    execArgv: ["--expose-gc"],
  },
});
