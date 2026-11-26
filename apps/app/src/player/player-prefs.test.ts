import { describe, expect, it } from "vitest";
import { defaultPrefs, parsePrefs } from "./player-prefs.ts";

describe("parsePrefs", () => {
  it("reads stored choices", () => {
    expect(parsePrefs('{"fit":"fill","quality":"4000","stats":true}')).toEqual({
      fit: "fill",
      quality: "4000",
      stats: true,
    });
  });

  it("keeps the default for anything missing, unknown or broken", () => {
    expect(parsePrefs(null)).toEqual(defaultPrefs);
    expect(parsePrefs("not json")).toEqual(defaultPrefs);
    expect(parsePrefs('{"fit":"zoom","quality":"9000","stats":"yes"}')).toEqual(defaultPrefs);
    expect(parsePrefs('{"quality":"original"}')).toEqual({
      fit: "fill",
      quality: "original",
      stats: false,
    });
  });
});
