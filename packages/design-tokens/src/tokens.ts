/**
 * The single source of truth for Slipstream's visual system, taken from
 * docs/design/web-v2/final/SPEC.md §3. Three layers: primitives (raw values), semantic (what a
 * colour is for, per theme and surface) and component (what a part of a component uses). The
 * generators turn this into Tailwind v4 CSS for the web and a React Native theme for the app.
 */
import { mixOklab, toHex, toRgbaString, withAlpha } from "./color.ts";

/** Raw palette: warm neutrals and the signal colours. Semantic tokens point at these. */
export const primitives = {
  ink: {
    950: "#050506",
    925: "#08080A",
    900: "#0A0A0C",
    875: "#0F0F12",
    850: "#151518",
    800: "#1C1C21",
    700: "#5E5D59",
    /** Light fg-3: AA on every light surface, raised guide cells and wells included. */
    650: "#686762",
    /** Dark fg-3: AA on every dark surface, raised guide cells and sheets included. */
    525: "#8A8984",
    500: "#95948E",
    450: "#9A9993",
    400: "#B2B1AB",
    300: "#C4C3BD",
    150: "#ECEBE6",
    125: "#EEEDE8",
    100: "#F3F2EE",
    75: "#F5F4F0",
    50: "#F6F5F1",
    0: "#FFFFFF",
    dark: "#131315",
    darker: "#141416",
    muted: "#4F4E4A",
    glass: "#16161A",
    black: "#000000",
  },
  amber: { 300: "#FFC233", 700: "#8A5E00", 950: "#1A1300" },
  red: {
    300: "#FF7080",
    350: "#FF6B7B",
    400: "#FF3D52",
    600: "#E0243A",
    650: "#D7263D",
    700: "#C8102E",
    800: "#C1132A",
  },
  orange: {
    300: "#FF9F5E",
    400: "#FF8A3D",
    700: "#C25300",
    800: "#A84700",
    900: "#8A3A00",
    950: "#1A0E05",
  },
  green: { 400: "#3DD68C", 700: "#0E8A55", 800: "#0B7347" },
  /** 700: light info text, AA on every light surface (300 is 1.9:1 there). */
  blue: { 300: "#8AB4FF", 700: "#2F5FB8" },
  violet: { 300: "#B98CFF", 600: "#7440DB", 700: "#6C35D1" },
} as const;

const { ink, amber, red, orange, green, blue, violet } = primitives;

/** A theme name: dark is the default, light follows the system or a choice, tv is dark for 3 m. */
export type ThemeName = "dark" | "light" | "tv";

/** The names to use in code, so a theme reads the same in CSS, React and React Native. */
export const themeNames: readonly ThemeName[] = ["dark", "light", "tv"];

/** A status colour set: the fill, text on that fill, coloured text, and a soft background. */
interface StatusColors {
  readonly solid: string;
  readonly onSolid: string;
  readonly text: string;
  readonly subtleBg: string;
}

/** What each colour is for. Every value is a CSS colour: hex when opaque, rgba when not. */
export interface SemanticColors {
  /** Page (`canvas`), inputs and sheets (`subtle`), panels, guide cells (`raised`), wells. */
  readonly bg: {
    readonly canvas: string;
    readonly subtle: string;
    readonly surface: string;
    readonly raised: string;
    readonly sunken: string;
  };
  /** Text: primary, secondary (AA), meta (AA where measured), decoration only (`faint`). */
  readonly fg: {
    readonly default: string;
    readonly muted: string;
    readonly subtle: string;
    readonly faint: string;
  };
  /** Hairlines: `subtle` is `--line`, `strong` is `--line-2` (control outlines). */
  readonly border: { readonly subtle: string; readonly faint: string; readonly strong: string };
  readonly focus: { readonly ring: string };
  /** Amber means "you": your position, the primary action, the selected tab bar. */
  readonly brand: {
    readonly solid: string;
    readonly onSolid: string;
    readonly text: string;
    readonly soft: string;
    readonly line: string;
    readonly edge: string;
    readonly glow: string;
  };
  readonly status: {
    /** Red: live, recording, now. `solid` carries white text, `indicator` is the dot. */
    readonly live: StatusColors & { readonly indicator: string };
    /** Green: healthy, will record. */
    readonly ok: StatusColors;
    /** Orange: attention, conflicts. `ink` is badge text on a tinted conflict row. */
    readonly warn: StatusColors & { readonly ink: string };
    /** Violet: an original, unconverted stream (the app's quality chip). */
    readonly orig: StatusColors;
    /** Blue: the first layout part in the editors. */
    readonly info: { readonly text: string };
  };
  readonly timeline: {
    readonly track: string;
    readonly captured: string;
    readonly played: string;
  };
  readonly state: { readonly hover: string; readonly pressed: string; readonly selected: string };
  /** Scrims, chips on video, the glass of the top bar and floating layers. */
  readonly overlay: {
    readonly scrim: string;
    readonly media: string;
    readonly glass: string;
    readonly nav: string;
  };
  /** The flat tone artwork shows while it loads. */
  readonly skeleton: { readonly fill: string };
}

const alpha = (color: string, amount: number) => toRgbaString(withAlpha(color, amount));

const dark: SemanticColors = {
  bg: {
    canvas: ink[900],
    subtle: ink[875],
    surface: ink[850],
    raised: ink[800],
    sunken: ink[925],
  },
  fg: { default: ink[100], muted: ink[400], subtle: ink[525], faint: ink[700] },
  border: {
    subtle: alpha(ink[0], 0.075),
    faint: alpha(ink[0], 0.045),
    strong: alpha(ink[0], 0.14),
  },
  focus: { ring: amber[300] },
  brand: {
    solid: amber[300],
    onSolid: amber[950],
    text: amber[300],
    soft: alpha(amber[300], 0.14),
    line: amber[300],
    edge: amber[300],
    glow: alpha(amber[300], 0.3),
  },
  status: {
    live: {
      solid: red[650],
      onSolid: ink[0],
      text: red[350],
      indicator: red[400],
      subtleBg: alpha(red[400], 0.14),
    },
    ok: {
      solid: green[400],
      onSolid: ink[900],
      text: green[400],
      subtleBg: alpha(green[400], 0.12),
    },
    warn: {
      solid: orange[400],
      onSolid: orange[950],
      text: orange[300],
      ink: orange[300],
      subtleBg: alpha(orange[400], 0.13),
    },
    orig: {
      solid: violet[300],
      onSolid: ink[900],
      text: violet[300],
      subtleBg: alpha(violet[300], 0.18),
    },
    info: { text: blue[300] },
  },
  timeline: {
    track: alpha(ink[0], 0.12),
    captured: alpha(ink[0], 0.34),
    played: ink[100],
  },
  state: {
    hover: alpha(ink[0], 0.055),
    pressed: alpha(ink[0], 0.09),
    selected: alpha(amber[300], 0.14),
  },
  overlay: {
    scrim: alpha(ink[900], 0.72),
    media: alpha(ink[950], 0.62),
    glass: alpha(ink.glass, 0.72),
    nav: alpha(ink[900], 0.78),
  },
  skeleton: { fill: alpha(ink[0], 0.065) },
};

const light: SemanticColors = {
  bg: {
    canvas: ink[75],
    subtle: ink[0],
    surface: ink[0],
    raised: ink[125],
    sunken: ink[150],
  },
  fg: { default: ink.dark, muted: ink.muted, subtle: ink[650], faint: ink[450] },
  border: {
    subtle: alpha(ink.darker, 0.09),
    faint: alpha(ink.darker, 0.05),
    strong: alpha(ink.darker, 0.16),
  },
  focus: { ring: ink.dark },
  brand: {
    solid: amber[300],
    onSolid: amber[950],
    text: amber[700],
    soft: alpha(amber[300], 0.22),
    line: amber[700],
    edge: amber[700],
    glow: alpha(amber[700], 0.22),
  },
  status: {
    live: {
      solid: red[700],
      onSolid: ink[0],
      text: red[800],
      indicator: red[600],
      subtleBg: alpha(red[600], 0.1),
    },
    ok: {
      solid: green[700],
      onSolid: ink[0],
      text: green[800],
      subtleBg: alpha(green[700], 0.1),
    },
    warn: {
      solid: orange[700],
      onSolid: ink[0],
      text: orange[800],
      ink: orange[900],
      subtleBg: alpha(orange[700], 0.1),
    },
    orig: {
      solid: violet[600],
      onSolid: ink[0],
      text: violet[700],
      subtleBg: alpha(violet[600], 0.12),
    },
    info: { text: blue[700] },
  },
  timeline: {
    track: alpha(ink.darker, 0.1),
    captured: alpha(ink.darker, 0.32),
    played: ink.dark,
  },
  state: {
    hover: alpha(ink.darker, 0.045),
    pressed: alpha(ink.darker, 0.08),
    selected: alpha(amber[300], 0.22),
  },
  overlay: {
    scrim: alpha(ink[75], 0.8),
    media: alpha(ink[950], 0.62),
    glass: alpha(ink[0], 0.78),
    nav: alpha(ink[75], 0.82),
  },
  skeleton: { fill: alpha(ink.darker, 0.06) },
};

/** TV is always dark; subtle text is brighter because it is read from the sofa. */
const tv: SemanticColors = { ...dark, fg: { ...dark.fg, subtle: ink[500] } };

/**
 * The cinema surface: the player, the Home hero, the mini player and dialogs opened from the
 * player stay dark in every theme. The web scopes it with `data-surface="cine"`.
 */
export const cine: SemanticColors = {
  ...dark,
  bg: { ...dark.bg, canvas: ink[950] },
  fg: { ...dark.fg, default: ink[50], muted: ink[300], subtle: ink[500] },
  border: {
    subtle: alpha(ink[0], 0.1),
    faint: alpha(ink[0], 0.06),
    strong: alpha(ink[0], 0.18),
  },
  brand: { ...dark.brand, soft: alpha(amber[300], 0.16) },
  status: {
    ...dark.status,
    live: { ...dark.status.live, text: red[300], subtleBg: alpha(red[400], 0.18) },
  },
  timeline: {
    track: alpha(ink[0], 0.16),
    captured: alpha(ink[0], 0.4),
    played: ink[50],
  },
  state: { ...dark.state, hover: alpha(ink[0], 0.08), pressed: alpha(ink[0], 0.12) },
  overlay: { ...dark.overlay, glass: alpha(ink.glass, 0.66) },
  skeleton: { fill: alpha(ink[0], 0.08) },
};

/** Semantic colours per theme. */
export const semantic: Readonly<Record<ThemeName, SemanticColors>> = { dark, light, tv };

/** Shadows for floating layers only; dark mode separates surfaces with hairlines instead. */
export interface Elevation {
  /** Menus, sheets, dialogs, the mini player and toasts. */
  readonly pop: string;
  /** The faint edge of a panel. */
  readonly card: string;
}

const darkElevation: Elevation = {
  pop: `0 24px 64px -12px ${alpha(ink.black, 0.7)}, 0 0 0 1px ${alpha(ink[0], 0.08)}`,
  card: `inset 0 1px 0 ${alpha(ink[0], 0.04)}`,
};

/** Elevation per theme, plus the cinema surface. TV is dark, so it has the dark shadows. */
export const elevation: Readonly<Record<ThemeName | "cine", Elevation>> = {
  dark: darkElevation,
  light: {
    pop: `0 24px 64px -16px ${alpha(ink.darker, 0.28)}, 0 0 0 1px ${alpha(ink.darker, 0.08)}`,
    card: `0 1px 2px ${alpha(ink.darker, 0.05)}, 0 0 0 1px ${alpha(ink.darker, 0.06)}`,
  },
  tv: darkElevation,
  cine: {
    pop: `0 24px 64px -12px ${alpha(ink.black, 0.7)}, 0 0 0 1px ${alpha(ink[0], 0.1)}`,
    card: `inset 0 1px 0 ${alpha(ink[0], 0.04)}`,
  },
};

/** Component tokens: what each part of a component paints with, derived from the semantic layer. */
export const componentColors = (c: SemanticColors) => ({
  button: {
    primary: { bg: c.brand.solid, fg: c.brand.onSolid, edge: c.brand.edge },
    secondary: { bg: c.state.hover, fg: c.fg.default, border: c.border.strong },
    ghost: { fg: c.fg.muted },
    danger: { fg: c.status.live.text },
  },
  chip: {
    neutral: { bg: c.state.hover, fg: c.fg.muted },
    live: { bg: c.status.live.solid, fg: c.status.live.onSolid },
    recording: { bg: c.status.live.subtleBg, fg: c.status.live.text },
    ok: { bg: c.status.ok.subtleBg, fg: c.status.ok.text },
    warn: { bg: c.status.warn.subtleBg, fg: c.status.warn.ink },
    orig: { bg: c.status.orig.subtleBg, fg: c.status.orig.text },
    outline: { border: c.border.strong, fg: c.fg.muted },
    // Chips on artwork or video keep the dark set in every theme.
    media: { bg: c.overlay.media, live: dark.status.live.text, orig: dark.status.orig.text },
  },
  timeline: {
    track: c.timeline.track,
    captured: c.timeline.captured,
    played: c.timeline.played,
    playhead: c.brand.solid,
    live: c.status.live.indicator,
  },
  guideCell: {
    bg: c.bg.raised,
    airingBg: c.bg.raised,
    pastBorder: c.border.subtle,
    pastFg: c.fg.subtle,
    meta: c.fg.muted,
    progress: alpha(c.status.live.indicator, 0.07),
    focusBg: c.brand.solid,
    focusFg: c.brand.onSolid,
    focusMeta: alpha(c.brand.onSolid, 0.75),
    focusProgress: alpha(c.brand.onSolid, 0.4),
  },
  row: {
    liveBg: toHex(mixOklab(c.status.live.indicator, 6, c.bg.surface)),
    conflictBg: toHex(mixOklab(c.status.warn.solid, 10, c.bg.surface)),
  },
  input: {
    border: c.border.strong,
    activeBorder: c.brand.solid,
    activeHalo: alpha(c.fg.default, 0.14),
  },
});

/** Component colours for one theme. */
export type ComponentColors = ReturnType<typeof componentColors>;

/**
 * Colours of generated artwork (SPEC §7.4). Artwork looks the same in both themes, so these are
 * not themed: carbon for sport, teal for crime, sepia for film, navy for news, and the warm
 * paper of film titles. Accents per title come from the hash ranges in `artworkAccents`.
 */
export const artwork = {
  carbon: "#18181C",
  carbonDeep: "#0B0B0D",
  crime: "#0D1416",
  crimeDeep: "#050708",
  filmDeep: "#0A0806",
  filmTitle: "#F4E6CC",
  filmKicker: "#E3C58F",
  newsDeep: "#050C1F",
  ink: "#FFFFFF",
  base: "#111111",
  off: "#222222",
} as const;

/**
 * Avatar tones (`AvatarTone` in the domain): one flat colour and the ink on it. Profiles pick
 * one, so they look the same in every theme.
 */
export const avatarTones = {
  amber: { fill: "#E9A23B", ink: "#1A1300" },
  teal: { fill: "#24908D", ink: "#FFFFFF" },
  violet: { fill: "#7A5AD1", ink: "#FFFFFF" },
  rose: { fill: "#C8475A", ink: "#FFFFFF" },
  green: { fill: "#2D8F5B", ink: "#FFFFFF" },
  blue: { fill: "#3B72D9", ink: "#FFFFFF" },
} as const;

/**
 * Hue, saturation and lightness ranges the generated artwork picks accents from, by genre.
 * `hues` lists fixed hues to choose from; `hue` is a base hue plus up to `spread` degrees.
 */
export const artworkAccents = {
  crime: { a1: { hue: 180, spread: 40, s: 45, l: 20 }, a2: { hues: [12, 190], s: 80, l: 62 } },
  film: { a1: { hue: 25, spread: 20, s: 45, l: 20 } },
  news: { a1: { hue: 212, spread: 16, s: 72, l: 30 } },
  doc: {
    a1: { hues: [28, 150], spread: 25, s: 38, l: 30 },
    a2: { hue: 200, spread: 30, s: 40, l: 12 },
  },
  kids: {
    a1: { hues: [42, 192, 340, 160, 255], s: 58, l: 52 },
    a2: { hues: [18, 165, 305, 130, 225], s: 50, l: 58 },
  },
  show: { a1: { s: 42, l: 32 }, a2: { offset: 50, s: 48, l: 12 } },
} as const;

/** Spacing in px (SPEC §3.3). Keys are px; Tailwind's 4 px base covers them on the web. */
export const space = {
  0: 0,
  2: 2,
  4: 4,
  6: 6,
  8: 8,
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  20: 20,
  24: 24,
  28: 28,
  32: 32,
  40: 40,
  48: 48,
  56: 56,
  64: 64,
} as const;

/**
 * Corner radii in px: chips in cards and logos, cards and inputs and art, panels, sheets and
 * dialogs; full for buttons, chips and segmented controls.
 */
export const radius = { s: 8, m: 12, l: 18, xl: 24, full: 9999 } as const;

/**
 * The control height scale (SPEC §3.5): every control in one row uses one step. Under a coarse
 * pointer `sm` and `md` grow, and every target reaches `minTarget` (an invisible hit area on
 * `sm` buttons).
 */
export const controls = {
  sm: { fine: 32, coarse: 40 },
  md: { fine: 40, coarse: 44 },
  lg: { fine: 48, coarse: 48 },
  minTarget: 44,
} as const;

/** Stacking order of the shell's layers. */
export const zIndex = {
  sticky: 4,
  nav: 40,
  mini: 42,
  overlay: 70,
  sheet: 71,
  menu: 80,
  toast: 90,
  skip: 100,
} as const;

/**
 * Type families with their CSS fallback stacks and the weights the design uses. Each stack
 * starts with the name `@fontsource-variable` registers ("Inter Variable"), then the plain
 * family for a locally installed font. `family` is the plain name the app loads fonts under.
 * The artwork faces are only for generated artwork and never hold up UI text.
 */
export const fonts = {
  display: {
    family: "Inter Tight",
    stack: [
      "Inter Tight Variable",
      "Inter Tight",
      "Inter Variable",
      "Inter Fallback",
      "sans-serif",
    ],
    weights: [500, 600, 650, 700, 750, 800],
  },
  ui: {
    family: "Inter",
    stack: [
      "Inter Variable",
      "Inter",
      "Inter Fallback",
      "ui-sans-serif",
      "system-ui",
      "-apple-system",
      "Segoe UI",
      "sans-serif",
    ],
    weights: [400, 500, 550, 600, 650, 700],
  },
  mono: {
    family: "ui-monospace",
    stack: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
    weights: [400, 500],
  },
  artSport: {
    family: "Anton",
    stack: ["Anton", "Inter Tight Variable", "sans-serif"],
    weights: [400],
  },
  artSerif: {
    family: "DM Serif Display",
    stack: ["DM Serif Display", "Georgia", "serif"],
    weights: [400],
  },
  artKids: {
    family: "Fredoka",
    stack: ["Fredoka Variable", "Fredoka", "Inter Tight Variable", "sans-serif"],
    weights: [600, 700],
  },
} as const;

/** A family key from {@link fonts}. */
export type FontRole = keyof typeof fonts;

/** One step of the type scale. */
interface TypeStep {
  readonly font: FontRole;
  readonly weight: number;
  readonly lineHeight: number;
  /** Letter spacing in em. */
  readonly tracking: number;
  readonly uppercase: boolean;
  /** Size in px on phones (React Native) and the web's fixed size. */
  readonly web: number;
  /** A fluid CSS size for the web where the role scales with the viewport. */
  readonly fluid?: string;
  /** Size in px at 1080p on TV. */
  readonly tv: number;
}

/** The type scale (SPEC §3.2). Minimum text size 12 px. */
export const typeScale = {
  display: {
    font: "display",
    weight: 750,
    lineHeight: 1,
    tracking: -0.04,
    uppercase: false,
    web: 34,
    fluid: "clamp(32px, 5vw, 64px)",
    tv: 80,
  },
  h1: {
    font: "display",
    weight: 700,
    lineHeight: 1.1,
    tracking: -0.03,
    uppercase: false,
    web: 26,
    fluid: "clamp(26px, 3vw, 34px)",
    tv: 42,
  },
  h2: {
    font: "display",
    weight: 650,
    lineHeight: 1.2,
    tracking: -0.02,
    uppercase: false,
    web: 20,
    tv: 34,
  },
  h3: {
    font: "display",
    weight: 600,
    lineHeight: 1.3,
    tracking: -0.01,
    uppercase: false,
    web: 16,
    tv: 30,
  },
  body: {
    font: "ui",
    weight: 400,
    lineHeight: 1.5,
    tracking: 0,
    uppercase: false,
    web: 15,
    tv: 26,
  },
  label: {
    font: "ui",
    weight: 600,
    lineHeight: 1.3,
    tracking: 0,
    uppercase: false,
    web: 14,
    tv: 24,
  },
  meta: {
    font: "ui",
    weight: 400,
    lineHeight: 1.4,
    tracking: 0,
    uppercase: false,
    web: 13,
    tv: 22,
  },
  caption: {
    font: "ui",
    weight: 600,
    lineHeight: 1.3333,
    tracking: 0,
    uppercase: false,
    web: 12,
    tv: 22,
  },
  eyebrow: {
    font: "ui",
    weight: 600,
    lineHeight: 1,
    tracking: 0.06,
    uppercase: true,
    web: 12,
    tv: 22,
  },
  readout: {
    font: "display",
    weight: 700,
    lineHeight: 1,
    tracking: -0.03,
    uppercase: false,
    web: 36,
    tv: 56,
  },
} as const satisfies Record<string, TypeStep>;

/** A density: how big text, targets and focus get on a form factor. */
interface Density {
  /** Smallest text allowed, px (TV at 1080p, touch in sp). */
  readonly minText: number;
  /** Smallest hit target, px or dp; null on TV, where focus replaces pointing. */
  readonly minTarget: number | null;
  /** Inset from the screen edge, px. */
  readonly safeMargin: number;
  /** Width of the focus ring, px. */
  readonly focusWidth: number;
  /** Which column of the type scale applies. */
  readonly typeScale: "web" | "tv";
}

/** Three densities share one scale: tv (10-foot), web (pointer and keyboard), touch (phone). */
export const densities = {
  tv: { minText: 22, minTarget: null, safeMargin: 64, focusWidth: 4, typeScale: "tv" },
  web: { minText: 12, minTarget: 24, safeMargin: 16, focusWidth: 2, typeScale: "web" },
  touch: { minText: 12, minTarget: 44, safeMargin: 16, focusWidth: 2, typeScale: "web" },
} as const satisfies Record<string, Density>;

/** A density key from {@link densities}. */
export type DensityName = keyof typeof densities;

/** Cubic bezier control points, as in CSS `cubic-bezier()`. */
type Bezier = readonly [number, number, number, number];

/** A motion setting with the variant used under reduced motion. */
interface Motion<T> {
  readonly default: T;
  readonly reduced: T;
}

/** A transition: duration in ms and easing. */
interface Transition {
  readonly durationMs: number;
  readonly easing: Bezier;
}

/** The one easing curve everything uses. */
const ease: Bezier = [0.2, 0.8, 0.2, 1];
const linear: Bezier = [0, 0, 1, 1];

/** What reduced motion turns every transition into (SPEC §3.4: effectively instant). */
const instant: Transition = { durationMs: 0.001, easing: linear };

/**
 * Motion (SPEC §3.4). `focus` is the fast step (hover, press, colour), `panel` the medium step
 * (panels, chrome, fades), `sheet` the slow step (sheets and dialogs). Animate only opacity,
 * transform and colours.
 */
export const motion = {
  focus: { default: { durationMs: 140, easing: ease }, reduced: instant },
  panel: { default: { durationMs: 260, easing: ease }, reduced: instant },
  sheet: { default: { durationMs: 320, easing: ease }, reduced: instant },
  /** The live dot's pulse, a looping animation. Zero means it does not run. */
  pulse: {
    default: { durationMs: 1600, easing: [0.45, 0, 0.55, 1] },
    reduced: { durationMs: 0, easing: linear },
  },
  /** The ring around the live edge of a timeline. */
  ring: { default: { durationMs: 2000, easing: ease }, reduced: { durationMs: 0, easing: linear } },
  /** Scale of a focused TV control and a focused picture card. */
  focusScale: { default: 1.04, reduced: 1 },
  cardFocusScale: { default: 1.06, reduced: 1 },
} as const satisfies Record<string, Motion<Transition> | Motion<number>>;

/** The live-edge ring: it grows from the dot and fades out. */
export const pulseKeyframes = {
  from: { scale: 0.5, opacity: 1 },
  to: { scale: 1.6, opacity: 0 },
} as const;

/** Focus styles: a 2 px ring with a 2 px gap on the web, amber fill plus ring on TV. */
export const focus = {
  web: { width: densities.web.focusWidth, offset: 2 },
  tv: { width: densities.tv.focusWidth, gap: 4 },
} as const;

/** Breakpoints in px (SPEC §2.1). The web never uses others. */
export const breakpoints = { sm: 600, md: 768, lg: 1100, xl: 1400 } as const;

/** The media query for short landscape screens (phones turned sideways), at any width. */
export const shortLandscape = "(max-height: 520px) and (orientation: landscape)";
