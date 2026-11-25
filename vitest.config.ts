import { defineConfig } from "vitest/config";

/** The root's own tests: the dev tooling in scripts/. Packages run their own Vitest configs. */
export default defineConfig({
  test: {
    name: "scripts",
    include: ["scripts/**/*.test.ts"],
    environment: "node",
  },
});
