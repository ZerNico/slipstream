import { defineConfig } from "vitest/config";

/** Only plain TypeScript modules are unit tested here; screens need a device or emulator. */
export default defineConfig({
  test: {
    name: "app",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
