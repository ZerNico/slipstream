import { afterEach, describe, expect, it } from "vitest";
import { deviceQualityLabel, householdDefaultHintText, qualityLabel } from "./quality-text.ts";
import { setLocale } from "./runtime.ts";

afterEach(() => setLocale("en"));

describe("qualityLabel", () => {
  it("names each default, with the bitrate cap where there is one", () => {
    expect(qualityLabel("auto")).toBe("Automatic");
    expect(qualityLabel("original")).toBe("Original");
    expect(qualityLabel("8000")).toMatch(/^High · 8/u);
    expect(qualityLabel("2000")).toMatch(/^Data saver · 2/u);
  });

  it("follows the language in effect", () => {
    setLocale("de");
    expect(qualityLabel("4000")).toMatch(/^Mittel · 4/u);
  });
});

describe("deviceQualityLabel", () => {
  it("calls a device's auto the server default, and names the rest as the server does", () => {
    expect(deviceQualityLabel("auto")).toBe("Default");
    expect(deviceQualityLabel("8000")).toBe(qualityLabel("8000"));
    setLocale("de");
    expect(deviceQualityLabel("auto")).toBe("Standard");
  });
});

describe("householdDefaultHintText", () => {
  it("says what the household default is now, or at home and away", () => {
    expect(householdDefaultHintText({ _tag: "One", quality: "original" })).toBe("Now Original");
    expect(householdDefaultHintText({ _tag: "HomeOrAway", home: "original", away: "auto" })).toBe(
      "At home Original, away Automatic",
    );
  });
});
