import { themes } from "@slipstream/design-tokens/native";
import { describe, expect, it } from "vitest";
import { emFor, motionFor, paletteOf, themeNameFor, tokenTheme } from "./palette.ts";

describe("themeNameFor", () => {
  it("keeps TV on the tuned dark theme and lets phones follow the system", () => {
    expect(themeNameFor(true, "light")).toBe("tv");
    expect(themeNameFor(false, "light")).toBe("light");
    expect(themeNameFor(false, "dark")).toBe("dark");
    expect(themeNameFor(false, null)).toBe("dark");
  });
});

describe("paletteOf", () => {
  it("takes every colour from the token theme", () => {
    const palette = paletteOf(tokenTheme("dark"));
    const dark = themes.dark.colors;
    expect(palette.bg).toBe(dark.bg.canvas);
    expect(palette.fg2).toBe(dark.fg.muted);
    expect(palette.brand).toBe(dark.brand.solid);
    expect(palette.live).toBe(dark.status.live.indicator);
    expect(palette.tlCap).toBe(dark.timeline.captured);
  });

  it("gives TV its own tertiary text and light its own brand text", () => {
    expect(paletteOf(tokenTheme("tv")).fg3).toBe(themes.tv.colors.fg.subtle);
    expect(paletteOf(tokenTheme("light")).brandText).not.toBe(
      paletteOf(tokenTheme("dark")).brandText,
    );
  });
});

describe("motionFor", () => {
  it("uses the reduced durations and no focus scale when motion is reduced", () => {
    expect(motionFor(false).tFocus).toBeGreaterThan(motionFor(true).tFocus);
    expect(motionFor(true).focusScale).toBe(1);
    expect(motionFor(false).easing).toHaveLength(4);
  });
});

describe("emFor", () => {
  it("sizes a phone by its short side, so it keeps its size turned sideways", () => {
    expect(emFor(false, 390, 844)).toBe(16);
    expect(emFor(false, 844, 390)).toBe(16);
  });

  it("stops a tablet's em at a large phone's", () => {
    expect(emFor(false, 800, 1280)).toBe(18);
  });

  it("sizes TV by its width", () => {
    expect(emFor(true, 1920, 1080)).toBe(24);
  });
});
