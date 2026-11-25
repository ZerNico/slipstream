import { describe, expect, it } from "vitest";
import {
  composite,
  contrast,
  mixOklab,
  parseColor,
  toHex,
  toRgbaString,
  withAlpha,
} from "./color.ts";

describe("parseColor", () => {
  it("reads hex, hex with alpha and rgba", () => {
    expect(parseColor("#FFC233")).toEqual({ r: 255, g: 194, b: 51, a: 1 });
    expect(parseColor("#00000080").a).toBeCloseTo(0.502, 3);
    expect(parseColor("rgba(6, 8, 12, .78)")).toEqual({ r: 6, g: 8, b: 12, a: 0.78 });
    expect(parseColor("rgb(1,2,3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it("rejects anything else", () => {
    expect(() => parseColor("amber")).toThrow("Not a colour: amber");
    expect(() => parseColor("#FFF")).toThrow("Not a colour: #FFF");
  });
});

describe("mixing and compositing", () => {
  it("mixes in OKLab like CSS color-mix", () => {
    // color-mix(in oklab, white 50%, black) is rgb(99, 99, 99) in browsers.
    expect(toHex(mixOklab("#FFFFFF", 50, "#000000"))).toBe("#636363");
    expect(toHex(mixOklab("#FFC233", 100, "#000000"))).toBe("#FFC233");
    expect(toHex(mixOklab("#FFC233", 0, "#121721"))).toBe("#121721");
  });

  it("composites a translucent colour over an opaque base in sRGB", () => {
    expect(toHex(composite("rgba(255, 255, 255, 0.5)", "#000000"))).toBe("#808080");
    expect(toHex(composite(withAlpha("#FF0000", 1), "#00FF00"))).toBe("#FF0000");
    expect(toHex(composite(withAlpha("#FF0000", 0), "#00FF00"))).toBe("#00FF00");
  });

  it("formats rgba with three decimals", () => {
    expect(toRgbaString(withAlpha("#E9EDF4", 0.38))).toBe("rgba(233, 237, 244, 0.38)");
    expect(toRgbaString({ r: 1, g: 2, b: 3, a: 1 / 3 })).toBe("rgba(1, 2, 3, 0.333)");
  });
});

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBe(1);
    // #767676 is the lightest grey that passes 4.5:1 on white.
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(contrast("#777777", "#FFFFFF")).toBeLessThan(4.5);
  });

  it("is symmetric for opaque colours", () => {
    expect(contrast("#FFC233", "#0B0E13")).toBeCloseTo(contrast("#0B0E13", "#FFC233"), 10);
  });

  it("composites a translucent foreground before measuring", () => {
    expect(contrast("rgba(0, 0, 0, 0)", "#FFFFFF")).toBe(1);
    // Half black over white is channel 127.5, between #7F7F7F and #808080.
    const half = contrast("rgba(0, 0, 0, 0.5)", "#FFFFFF");
    expect(half).toBeGreaterThan(contrast("#808080", "#FFFFFF"));
    expect(half).toBeLessThan(contrast("#7F7F7F", "#FFFFFF"));
  });
});
