import { afterEach, describe, expect, it } from "vitest";
import { m, setLocale } from "@slipstream/i18n";
import { isApplePlatform } from "./platform.ts";

afterEach(() => setLocale("en"));

describe("the search shortcut hint", () => {
  it("says ⌘K on Apple platforms and Ctrl K (Strg K) everywhere else", () => {
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0)" })).toBe(
      true,
    );
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isApplePlatform({})).toBe(false);
    expect(m.shell_search_key({ apple: true })).toBe("⌘K");
    expect(m.shell_search_key({ apple: false })).toBe("Ctrl K");
    setLocale("de");
    expect(m.shell_search_key({ apple: false })).toBe("Strg K");
    expect(m.shell_search_label({ key: "Strg K" })).toBe("Suche (Strg K)");
  });
});
