import { describe, expect, it } from "vitest";
import { messageKeys } from "./catalogue.ts";

declare global {
  interface ImportMeta {
    /** Vite's build-time glob, which Vitest runs: here every source file, as text. */
    readonly glob: (
      patterns: readonly string[],
      options: { readonly query: "?raw"; readonly import: "default"; readonly eager: true },
    ) => Record<string, string>;
  }
}

/**
 * Every source file that may say something to a person: the apps (web, app with its routes,
 * server) and the packages. Tests do not count, so a key only a test reads is still unused.
 */
const sources = import.meta.glob(
  [
    "../../../apps/*/src/**/*.{ts,tsx}",
    "../../../apps/app/app/**/*.{ts,tsx}",
    "../../../packages/*/src/**/*.{ts,tsx}",
    "!**/node_modules/**",
    "!**/*.test.{ts,tsx}",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Every identifier-like word in the sources: `m.nav_home()` contributes `nav_home`. */
const words = new Set(Object.values(sources).flatMap((text) => text.match(/\w+/gu) ?? []));

describe("unused messages", () => {
  it("reads the sources of every app and package", () => {
    // Vite writes paths inside this package's parent (`packages/`) as `../../domain/src/…`.
    const paths = Object.keys(sources);
    for (const root of ["apps/web/src/", "apps/app/app/", "apps/server/src/", "/domain/src/"]) {
      expect(paths.some((path) => path.includes(root))).toBe(true);
    }
  });

  it("has no message nothing refers to", () => {
    const unused = messageKeys.filter((key) => !words.has(key));
    expect(unused).toEqual([]);
  });
});
