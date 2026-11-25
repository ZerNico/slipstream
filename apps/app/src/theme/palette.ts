import {
  motion as tokenMotion,
  radius,
  themes,
  type Theme as TokenTheme,
  type ThemeName,
} from "@slipstream/design-tokens/native";

/**
 * The colours components read, named after the design doc's CSS custom properties (`--fg-2` is
 * `fg2`) so screens read like the mockups. Every value comes from @slipstream/design-tokens.
 */
export interface Palette {
  readonly bg: string;
  readonly surface: string;
  readonly raised: string;
  readonly line: string;
  readonly borderStrong: string;
  readonly fg: string;
  readonly fg2: string;
  readonly fg3: string;
  readonly brand: string;
  readonly onBrand: string;
  readonly brandText: string;
  readonly focusRing: string;
  readonly live: string;
  readonly liveSolid: string;
  readonly onLive: string;
  readonly liveText: string;
  readonly ok: string;
  readonly okText: string;
  readonly warn: string;
  readonly warnText: string;
  readonly orig: string;
  readonly tlTrack: string;
  readonly tlCap: string;
  readonly tlPlayed: string;
  readonly scrim: string;
  readonly media: string;
}

/** Flattens a token theme into the palette components use. */
export const paletteOf = (theme: TokenTheme): Palette => {
  const { colors, components } = theme;
  return {
    bg: colors.bg.canvas,
    surface: colors.bg.surface,
    raised: colors.bg.raised,
    line: colors.border.subtle,
    borderStrong: colors.border.strong,
    fg: colors.fg.default,
    fg2: colors.fg.muted,
    fg3: colors.fg.subtle,
    brand: colors.brand.solid,
    onBrand: colors.brand.onSolid,
    brandText: colors.brand.text,
    focusRing: colors.focus.ring,
    live: colors.status.live.indicator,
    liveSolid: colors.status.live.solid,
    onLive: colors.status.live.onSolid,
    liveText: colors.status.live.text,
    ok: colors.status.ok.solid,
    okText: colors.status.ok.text,
    warn: colors.status.warn.solid,
    warnText: colors.status.warn.text,
    orig: colors.status.orig.solid,
    tlTrack: components.timeline.track,
    tlCap: colors.timeline.captured,
    tlPlayed: colors.timeline.played,
    scrim: colors.overlay.scrim,
    media: colors.overlay.media,
  };
};

/** TV is always the tuned dark theme; phones follow the system, dark when it says nothing. */
export const themeNameFor = (isTV: boolean, scheme: string | null | undefined): ThemeName =>
  isTV ? "tv" : scheme === "light" ? "light" : "dark";

/** TV frame width in em, from the TV mockups. */
const TV_EM_PER_WIDTH = 80;
/** Phone frame width in em, from the phone mockups (16 dp at 390 dp). */
const PHONE_EM_PER_WIDTH = 24.375;
/** The largest phone em: a tablet's frame stays the size of a large phone's, not a poster's. */
const PHONE_EM_MAX = 18;

/**
 * One design unit in dp. The mockups size everything in em of a scaled frame: TV is 80 em wide
 * (24 px at 1080p), phone 24.375 em. A phone scales by its short side, so turning it sideways
 * keeps every control the size it had upright instead of growing with the long side.
 */
export const emFor = (isTV: boolean, width: number, height: number): number =>
  isTV
    ? width / TV_EM_PER_WIDTH
    : Math.min(Math.min(width, height) / PHONE_EM_PER_WIDTH, PHONE_EM_MAX);

/** The token theme for a name. */
export const tokenTheme = (name: ThemeName): TokenTheme => themes[name];

/**
 * Font families as expo-font registers them (one family per weight on Android). Display is Big
 * Shoulders Display, UI is Geist and mono is Geist Mono, the families the tokens name.
 */
export const fonts = {
  fDisplay: "BigShoulders_800ExtraBold",
  fDisplayBold: "BigShoulders_700Bold",
  fUi: "Geist_400Regular",
  fUiMedium: "Geist_500Medium",
  fUiSemiBold: "Geist_600SemiBold",
  fMono: "GeistMono_400Regular",
  fMonoSemiBold: "GeistMono_600SemiBold",
} as const;

/** Corner radii in dp from the tokens. */
export const radii = { rS: radius.s, rM: radius.m, rL: radius.l } as const;

/** Durations and easing a component animates with. */
export interface Motion {
  readonly tFocus: number;
  readonly tPanel: number;
  readonly easing: readonly [number, number, number, number];
  readonly focusScale: number;
  readonly cardFocusScale: number;
}

const bezier = (points: readonly number[]): Motion["easing"] => [
  points[0] ?? 0,
  points[1] ?? 0,
  points[2] ?? 1,
  points[3] ?? 1,
];

/** Motion tokens, with the reduced variants when the system asks for less motion. */
export const motionFor = (reduced: boolean): Motion => {
  const variant = reduced ? "reduced" : "default";
  return {
    tFocus: tokenMotion.focus[variant].durationMs,
    tPanel: tokenMotion.panel[variant].durationMs,
    easing: bezier(tokenMotion.focus[variant].easing),
    focusScale: tokenMotion.focusScale[variant],
    cardFocusScale: tokenMotion.cardFocusScale[variant],
  };
};
