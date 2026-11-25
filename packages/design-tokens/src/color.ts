/**
 * Colour math for the token build: parsing, OKLab mixing, sRGB compositing and WCAG contrast.
 * React Native has no `color-mix`, so every tint is resolved here to a plain hex value.
 */

/** A colour with straight (not premultiplied) alpha; channels are 0 to 255, alpha 0 to 1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX = /^#(?<rgb>[0-9a-f]{6})(?<alpha>[0-9a-f]{2})?$/i;
const RGBA =
  /^rgba?\(\s*(?<r>[\d.]+)\s*,\s*(?<g>[\d.]+)\s*,\s*(?<b>[\d.]+)\s*(?:,\s*(?<a>[\d.]+)\s*)?\)$/;

/**
 * Parses `#RRGGBB`, `#RRGGBBAA`, `rgb(r, g, b)` or `rgba(r, g, b, a)`.
 * Throws on anything else, so a typo in the token source fails the build.
 */
export const parseColor = (input: string): Rgba => {
  const hex = HEX.exec(input)?.groups;
  if (hex?.rgb) {
    const value = Number.parseInt(hex.rgb, 16);
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff,
      a: hex.alpha ? Number.parseInt(hex.alpha, 16) / 255 : 1,
    };
  }
  const rgba = RGBA.exec(input)?.groups;
  if (rgba?.r && rgba.g && rgba.b) {
    return { r: Number(rgba.r), g: Number(rgba.g), b: Number(rgba.b), a: Number(rgba.a ?? 1) };
  }
  throw new Error(`Not a colour: ${input}`);
};

const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
const byteHex = (value: number) => clampByte(value).toString(16).padStart(2, "0").toUpperCase();

/** Formats an opaque colour as `#RRGGBB`; alpha is ignored. */
export const toHex = ({ r, g, b }: Rgba): string => `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;

/** Formats a colour as `rgba(r, g, b, a)` with alpha rounded to three places. */
export const toRgbaString = ({ r, g, b, a }: Rgba): string =>
  `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${Number(a.toFixed(3))})`;

/** The same colour at a given alpha, what `color-mix(in oklab, c p%, transparent)` resolves to. */
export const withAlpha = (color: string, alpha: number): Rgba => ({
  ...parseColor(color),
  a: alpha,
});

/**
 * Paints `top` over an opaque `base` the way a browser composites: per channel in sRGB.
 * The result is opaque.
 */
export const composite = (top: Rgba | string, base: Rgba | string): Rgba => {
  const fg = typeof top === "string" ? parseColor(top) : top;
  const bg = typeof base === "string" ? parseColor(base) : base;
  const mixChannel = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mixChannel(fg.r, bg.r), g: mixChannel(fg.g, bg.g), b: mixChannel(fg.b, bg.b), a: 1 };
};

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) =>
  255 * (c <= 0.003_130_8 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

type Lab = readonly [number, number, number];

const toOklab = ({ r, g, b }: Rgba): Lab => {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.412_221_470_8 * lr + 0.536_332_536_3 * lg + 0.051_445_992_9 * lb);
  const m = Math.cbrt(0.211_903_498_2 * lr + 0.680_699_545_1 * lg + 0.107_396_956_6 * lb);
  const s = Math.cbrt(0.088_302_461_9 * lr + 0.281_718_837_6 * lg + 0.629_978_700_5 * lb);
  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ];
};

const fromOklab = ([L, A, B]: Lab, a: number): Rgba => {
  const l = (L + 0.396_337_777_4 * A + 0.215_803_757_3 * B) ** 3;
  const m = (L - 0.105_561_345_8 * A - 0.063_854_172_8 * B) ** 3;
  const s = (L - 0.089_484_177_5 * A - 1.291_485_548 * B) ** 3;
  return {
    r: fromLinear(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    g: fromLinear(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    b: fromLinear(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
    a,
  };
};

/**
 * `color-mix(in oklab, a p%, b)` for two opaque colours: `percent` of `a`, the rest `b`.
 */
export const mixOklab = (a: string, percent: number, b: string): Rgba => {
  const p = percent / 100;
  const la = toOklab(parseColor(a));
  const lb = toOklab(parseColor(b));
  return fromOklab(
    [la[0] * p + lb[0] * (1 - p), la[1] * p + lb[1] * (1 - p), la[2] * p + lb[2] * (1 - p)],
    1,
  );
};

/** WCAG 2 relative luminance of an opaque colour. */
export const luminance = (color: Rgba | string): number => {
  const { r, g, b } = typeof color === "string" ? parseColor(color) : color;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

/**
 * WCAG 2 contrast ratio between a foreground and an opaque background. A translucent
 * foreground is composited over the background first, as a screen would show it.
 */
export const contrast = (foreground: Rgba | string, background: Rgba | string): number => {
  const bg = typeof background === "string" ? parseColor(background) : background;
  const fg = composite(foreground, bg);
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
