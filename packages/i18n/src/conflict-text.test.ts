import { afterEach, describe, expect, it } from "vitest";
import { resolveIntro } from "./conflict-text.ts";
import { setLocale } from "./runtime.ts";

afterEach(() => setLocale("en"));

const from = Date.UTC(2026, 10, 22, 19);
const to = Date.UTC(2026, 10, 22, 21);

describe("resolveIntro", () => {
  it("says the room the conflict allows, or no number", () => {
    expect(resolveIntro({ count: 3, from, to, room: { kind: "free", streams: 1 } })).toContain(
      "but only 1 stream is free then",
    );
    expect(resolveIntro({ count: 3, from, to, room: { kind: "free", streams: 0 } })).toContain(
      "but no stream is free then",
    );
    expect(resolveIntro({ count: 3, from, to, room: { kind: "unknown" } })).not.toMatch(/only \d/u);
  });

  it("follows the language in effect", () => {
    setLocale("de");
    expect(resolveIntro({ count: 3, from, to, room: { kind: "free", streams: 1 } })).toContain(
      "aber dann ist nur 1 Stream frei",
    );
  });
});
