import { describe, expect, it } from "vitest";
import {
  detectRegion,
  detectRegionParts,
  formatTag,
  isLocale,
  matchLocale,
  matchLocaleParts,
  regionOf,
} from "./locales.ts";

describe("locales", () => {
  it("matches the first preferred language that has a catalogue", () => {
    expect(matchLocale(["fr-FR", "de-AT", "en-US"])).toBe("de");
    expect(matchLocale(["en_GB"])).toBe("en");
    expect(matchLocale(["fr-FR", "not a tag"])).toBe("en");
    expect(matchLocale([])).toBe("en");
  });

  it("matches already split locales (the app, where Hermes has no Intl.Locale)", () => {
    const device = [
      { language: "de", region: "DE" },
      { language: "en", region: "US" },
    ];
    expect(matchLocaleParts(device)).toBe("de");
    expect(matchLocaleParts([{ language: "fr", region: "FR" }])).toBe("en");
    expect(detectRegionParts("de", device)).toBe("DE");
    expect(detectRegionParts("en", [{ language: "de", region: "AT" }])).toBe("AT");
    expect(detectRegionParts("de", [{ language: null, region: null }])).toBeUndefined();
  });

  it("recognises locales", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("de-DE")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("reads regions from tags", () => {
    expect(regionOf("de-AT")).toBe("AT");
    expect(regionOf("en_GB")).toBe("GB");
    expect(regionOf("de")).toBeUndefined();
    expect(regionOf("???")).toBeUndefined();
    expect(regionOf(undefined)).toBeUndefined();
  });

  it("detects the region for the language first, then any region", () => {
    expect(detectRegion("en", ["de-DE", "en-GB"])).toBe("GB");
    expect(detectRegion("en", ["de-DE", "en"])).toBe("DE");
    expect(detectRegion("de", ["de", "fr"])).toBeUndefined();
  });

  it("pairs a language with a region only when the platform knows the pair", () => {
    expect(formatTag("en", "DE")).toBe("en-DE");
    expect(formatTag("de", "AT")).toBe("de-AT");
    expect(formatTag("de", "US")).toBe("de");
    expect(formatTag("en", undefined)).toBe("en");
  });
});
