/**
 * The stored playback settings: a value saved before "Simultaneous picture conversions" existed
 * keeps its other choices and reads as no limit; one that no longer decodes is the defaults.
 */
import { describe, expect, it } from "vitest";
import { initialPlaybackSettings, readStoredPlayback } from "../src/settings/service.ts";

describe("stored playback settings", () => {
  it("reads a value saved before the picture conversion limit as no limit", () => {
    const saved = JSON.stringify({
      hardwareAcceleration: "off",
      preference: "power",
      maxConversions: 2,
      quality: { home: "original", away: "4000", mobile: "2000" },
    });
    expect(readStoredPlayback(saved)).toEqual({
      hardwareAcceleration: "off",
      preference: "power",
      pictureConversions: "unlimited",
      quality: { home: "original", away: "4000", mobile: "2000" },
    });
  });

  it("keeps a saved limit", () => {
    const saved = JSON.stringify({ ...initialPlaybackSettings, pictureConversions: "auto" });
    expect(readStoredPlayback(saved).pictureConversions).toBe("auto");
  });

  it("falls back to the defaults for nothing saved or a value that no longer decodes", () => {
    expect(readStoredPlayback(undefined)).toEqual(initialPlaybackSettings);
    expect(readStoredPlayback('{"pictureConversions":"many"}')).toEqual(initialPlaybackSettings);
  });
});
