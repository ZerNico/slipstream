/**
 * Turns the token source into the generated files: Tailwind v4 CSS for the web and a typed
 * React Native theme module. Pure string builders, so a test can check the committed files
 * are up to date without writing anything.
 */
import { composite, parseColor, toHex } from "./color.ts";
import {
  artwork,
  avatarTones,
  breakpoints,
  cine,
  componentColors,
  controls,
  densities,
  elevation,
  type Elevation,
  focus,
  fonts,
  motion,
  pulseKeyframes,
  radius,
  semantic,
  type SemanticColors,
  space,
  type ThemeName,
  themeNames,
  typeScale,
  zIndex,
} from "./tokens.ts";

type Getter = (c: SemanticColors) => string;

/**
 * The colour custom properties, named as in SPEC §3.1. Components use these through Tailwind
 * (`bg-surface`, `text-fg-2`) or directly in CSS (`var(--line)`).
 */
export const cssColorVars: ReadonlyArray<readonly [string, Getter]> = [
  ["bg", (c) => c.bg.canvas],
  ["bg-2", (c) => c.bg.subtle],
  ["surface", (c) => c.bg.surface],
  ["raised", (c) => c.bg.raised],
  ["sunken", (c) => c.bg.sunken],
  ["hover", (c) => c.state.hover],
  ["press", (c) => c.state.pressed],
  ["selected", (c) => c.state.selected],
  ["line", (c) => c.border.subtle],
  ["line-2", (c) => c.border.strong],
  ["line-faint", (c) => c.border.faint],
  ["fg", (c) => c.fg.default],
  ["fg-2", (c) => c.fg.muted],
  ["fg-3", (c) => c.fg.subtle],
  ["fg-4", (c) => c.fg.faint],
  ["brand", (c) => c.brand.solid],
  ["brand-fg", (c) => c.brand.text],
  ["brand-soft", (c) => c.brand.soft],
  ["brand-edge", (c) => c.brand.edge],
  ["on-brand", (c) => c.brand.onSolid],
  ["glow", (c) => c.brand.glow],
  ["live", (c) => c.status.live.indicator],
  ["live-fg", (c) => c.status.live.text],
  ["live-soft", (c) => c.status.live.subtleBg],
  ["live-solid", (c) => c.status.live.solid],
  ["on-live", (c) => c.status.live.onSolid],
  ["warn", (c) => c.status.warn.solid],
  ["warn-fg", (c) => c.status.warn.text],
  ["warn-soft", (c) => c.status.warn.subtleBg],
  ["warn-ink", (c) => c.status.warn.ink],
  ["on-warn", (c) => c.status.warn.onSolid],
  ["ok", (c) => c.status.ok.solid],
  ["ok-fg", (c) => c.status.ok.text],
  ["ok-soft", (c) => c.status.ok.subtleBg],
  ["on-ok", (c) => c.status.ok.onSolid],
  ["orig", (c) => c.status.orig.solid],
  ["orig-fg", (c) => c.status.orig.text],
  ["orig-soft", (c) => c.status.orig.subtleBg],
  ["info", (c) => c.status.info.text],
  ["focus", (c) => c.focus.ring],
  ["tl-track", (c) => c.timeline.track],
  ["tl-cap", (c) => c.timeline.captured],
  ["tl-played", (c) => c.timeline.played],
  ["scrim", (c) => c.overlay.scrim],
  ["media-scrim", (c) => c.overlay.media],
  ["glass", (c) => c.overlay.glass],
  ["nav-bg", (c) => c.overlay.nav],
  ["sk", (c) => c.skeleton.fill],
];

/** shadcn's variable names mapped onto ours. `accent` is a subtle hover, never the brand. */
const shadcnVars: ReadonlyArray<readonly [string, string]> = [
  ["background", "bg"],
  ["foreground", "fg"],
  ["card", "surface"],
  ["card-foreground", "fg"],
  ["popover", "surface"],
  ["popover-foreground", "fg"],
  ["primary", "brand"],
  ["primary-foreground", "on-brand"],
  ["secondary", "hover"],
  ["secondary-foreground", "fg"],
  ["muted", "raised"],
  ["muted-foreground", "fg-2"],
  ["accent", "hover"],
  ["accent-foreground", "fg"],
  ["destructive", "live-solid"],
  ["destructive-foreground", "on-live"],
  ["border", "line"],
  ["input", "line-2"],
  ["ring", "focus"],
];

const kebab = (key: string) => key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

type Tree = { readonly [key: string]: string | Tree };

const flatten = (tree: Tree, prefix: readonly string[] = []): Array<readonly [string[], string]> =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[[...prefix, key], value] as const]
      : flatten(value, [...prefix, key]),
  );

const elevationVars = (e: Elevation): Array<readonly [string, string]> => [
  ["elev-pop", e.pop],
  ["elev-card", e.card],
];

/** Every themed colour custom property for one set of semantic colours. */
const colorVarsOf = (colors: SemanticColors): Array<readonly [string, string]> =>
  cssColorVars.map(([name, get]) => [name, get(colors)] as const);

/** Every themed custom property for one theme: colours, then elevation. */
export const themeVars = (theme: ThemeName): Array<readonly [string, string]> => [
  ...colorVarsOf(semantic[theme]),
  ...elevationVars(elevation[theme]),
];

/** The cinema surface's custom properties: the full colour set, so it is dark inside light. */
export const cineVars = (): Array<readonly [string, string]> => [
  ...colorVarsOf(cine),
  ...elevationVars(elevation.cine),
];

const bezier = (points: readonly number[]) => `cubic-bezier(${points.join(", ")})`;
const ms = (durationMs: number) => `${durationMs}ms`;
const fontStack = (stack: readonly string[]) =>
  stack.map((name) => (/\s/.test(name) ? `"${name}"` : name)).join(", ");
const px = (value: number) => `${value}px`;

/** Hex in lower case, the way the formatter writes CSS. */
const cssValue = (value: string) => (value.startsWith("#") ? value.toLowerCase() : value);

/** Line width of the repository formatter, which the generated CSS has to match. */
const printWidth = 100;

/**
 * One custom property. A list too long for one line (a font stack, a shadow) wraps after
 * commas the way the formatter does, so formatting never makes the committed file stale.
 */
const declaration = (name: string, value: string, indent: string) => {
  const line = `${indent}--${name}: ${value};`;
  if (line.length <= printWidth) return line;
  const inner = `${indent}  `;
  // Split on top-level commas only, so `rgba(0, 0, 0, 0.7)` stays whole.
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  if (value.includes("(") && parts.length > 1) {
    return `${indent}--${name}:\n${parts.map((part, i) => `${inner}${part}${i < parts.length - 1 ? "," : ";"}`).join("\n")}`;
  }
  const lines: Array<string> = [];
  let row = "";
  parts.forEach((part, index) => {
    const piece = index < parts.length - 1 ? `${part},` : `${part};`;
    const candidate = row === "" ? `${inner}${piece}` : `${row} ${piece}`;
    if (candidate.length > printWidth && row !== "") {
      lines.push(row);
      row = `${inner}${piece}`;
    } else {
      row = candidate;
    }
  });
  lines.push(row);
  return `${indent}--${name}:\n${lines.join("\n")}`;
};

const declarations = (vars: ReadonlyArray<readonly [string, string]>, indent: string) =>
  vars.map(([name, value]) => declaration(name, cssValue(value), indent)).join("\n");

const staticVars: ReadonlyArray<readonly [string, string]> = [
  ["f-display", fontStack(fonts.display.stack)],
  ["f-ui", fontStack(fonts.ui.stack)],
  ["f-mono", fontStack(fonts.mono.stack)],
  ["f-art-sport", fontStack(fonts.artSport.stack)],
  ["f-art-serif", fontStack(fonts.artSerif.stack)],
  ["f-art-kids", fontStack(fonts.artKids.stack)],
  ["r-s", px(radius.s)],
  ["r-m", px(radius.m)],
  ["r-l", px(radius.l)],
  ["r-xl", px(radius.xl)],
  ["ease", bezier(motion.focus.default.easing)],
  ["t-fast", ms(motion.focus.default.durationMs)],
  ["t-med", ms(motion.panel.default.durationMs)],
  ["t-slow", ms(motion.sheet.default.durationMs)],
  ["t-pulse", ms(motion.pulse.default.durationMs)],
  ["t-ring", ms(motion.ring.default.durationMs)],
  ["ctl-sm", px(controls.sm.fine)],
  ["ctl-md", px(controls.md.fine)],
  ["ctl-lg", px(controls.lg.fine)],
  ["tap-min", px(controls.minTarget)],
  ["focus-width", px(focus.web.width)],
  ["focus-offset", px(focus.web.offset)],
  ...Object.entries(zIndex).map(([name, value]) => [`z-${name}`, String(value)] as const),
  ...Object.entries(artwork).map(([name, value]) => [`art-${kebab(name)}`, value] as const),
  ...Object.entries(avatarTones).flatMap(([name, tone]) => [
    [`av-${name}`, tone.fill] as const,
    [`av-${name}-ink`, tone.ink] as const,
  ]),
];

const coarseVars: ReadonlyArray<readonly [string, string]> = [
  ["ctl-sm", px(controls.sm.coarse)],
  ["ctl-md", px(controls.md.coarse)],
  ["ctl-lg", px(controls.lg.coarse)],
];

const reducedVars: ReadonlyArray<readonly [string, string]> = [
  ["t-fast", ms(motion.focus.reduced.durationMs)],
  ["t-med", ms(motion.panel.reduced.durationMs)],
  ["t-slow", ms(motion.sheet.reduced.durationMs)],
  ["animate-live-pulse", "none"],
  ["animate-ring", "none"],
];

const themeColorNames = [...cssColorVars.map(([name]) => name), ...shadcnVars.map(([n]) => n)];

const themeInline = (): string => {
  const lines = [
    "  --color-*: initial;",
    ...themeColorNames.map((name) => `  --color-${name}: var(--${name});`),
    "",
    "  --font-*: initial;",
    "  --font-display: var(--f-display);",
    "  --font-sans: var(--f-ui);",
    "  --font-mono: var(--f-mono);",
    "  --font-art-sport: var(--f-art-sport);",
    "  --font-art-serif: var(--f-art-serif);",
    "  --font-art-kids: var(--f-art-kids);",
    "",
    "  --radius-sm: var(--r-s);",
    "  --radius-md: var(--r-m);",
    "  --radius-lg: var(--r-l);",
    "  --radius-xl: var(--r-xl);",
    "",
    "  --shadow-pop: var(--elev-pop);",
    "  --shadow-card: var(--elev-card);",
    "",
    "  --spacing-ctl-sm: var(--ctl-sm);",
    "  --spacing-ctl-md: var(--ctl-md);",
    "  --spacing-ctl-lg: var(--ctl-lg);",
    "  --spacing-tap: var(--tap-min);",
    "",
    "  --ease-standard: var(--ease);",
    "  --duration-fast: var(--t-fast);",
    "  --duration-med: var(--t-med);",
    "  --duration-slow: var(--t-slow);",
    "",
  ];
  for (const [name, step] of Object.entries(typeScale)) {
    const key = kebab(name);
    const size = "fluid" in step ? step.fluid : px(step.web);
    lines.push(
      `  --text-${key}: ${size};`,
      `  --text-${key}--line-height: ${step.lineHeight};`,
      `  --text-${key}--font-weight: ${step.weight};`,
      `  --text-${key}--letter-spacing: ${step.tracking}em;`,
    );
  }
  return lines.join("\n");
};

const { from, to } = pulseKeyframes;

/**
 * The Tailwind v4 stylesheet: dark defaults on `:root` and `.tv`, light through
 * `prefers-color-scheme` or `[data-theme="light"]`, the always-dark cinema surface on
 * `[data-surface="cine"]`, coarse-pointer control heights, reduced motion, and the `@theme`
 * blocks that map every token (and shadcn's names) to utilities.
 */
export const buildTailwindCss = (): string => {
  const dark = themeVars("dark");
  const darkValues = new Map(dark);
  const tvOnly = themeVars("tv").filter(([name, value]) => darkValues.get(name) !== value);
  const shadcn = shadcnVars.map(([name, target]) => [name, `var(--${target})`] as const);

  return `/* Generated by packages/design-tokens/scripts/generate.ts from src/tokens.ts. Do not edit. */

:root,
.tv {
${declarations(dark, "  ")}

${declarations(staticVars, "  ")}

${declarations([...shadcn, ["radius", "var(--r-m)"]], "  ")}

  color-scheme: dark;
}

.tv {
${declarations(tvOnly, "  ")}
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
${declarations(themeVars("light"), "    ")}

    color-scheme: light;
  }
}

:root[data-theme="light"] {
${declarations(themeVars("light"), "  ")}

  color-scheme: light;
}

[data-surface="cine"] {
${declarations(cineVars(), "  ")}

  color-scheme: dark;
}

@media (pointer: coarse) {
  :root {
${declarations(coarseVars, "    ")}
  }
}

@media (prefers-reduced-motion: reduce) {
  :root,
  .tv {
${declarations(reducedVars, "    ")}
  }
}

@theme inline {
${themeInline()}
}

@theme {
  --breakpoint-*: initial;
${Object.entries(breakpoints)
  .map(([name, value]) => `  --breakpoint-${name}: ${px(value)};`)
  .join("\n")}

  --animate-live-pulse: live-pulse var(--t-pulse) ease-in-out infinite;
  --animate-ring: ring var(--t-ring) var(--ease) infinite;

  @keyframes live-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  @keyframes ring {
    from {
      transform: scale(${from.scale});
      opacity: ${from.opacity};
    }
    to {
      transform: scale(${to.scale});
      opacity: ${to.opacity};
    }
  }
}
`;
};

/** The bases a translucent colour is precomputed over in React Native. */
const tintBases = (c: SemanticColors) => ({
  canvas: c.bg.canvas,
  surface: c.bg.surface,
  raised: c.bg.raised,
  brand: c.brand.solid,
});

const camel = (name: string) =>
  name.replaceAll(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/** Every colour React Native may need precomputed: CSS colours and component colours. */
const nativeColorVars = (theme: ThemeName): Array<readonly [string, string]> => {
  const colors = semantic[theme];
  return [
    ...colorVarsOf(colors),
    ...flatten(componentColors(colors)).map(
      ([path, value]) => [path.map(kebab).join("-"), value] as const,
    ),
  ];
};

/** Every translucent token resolved to an opaque hex over each base, keyed by its CSS name. */
export const nativeTints = (theme: ThemeName): Record<string, Record<string, string>> => {
  const bases = tintBases(semantic[theme]);
  const translucent = nativeColorVars(theme).filter(([, value]) => parseColor(value).a < 1);
  return Object.fromEntries(
    translucent.map(([name, value]) => [
      camel(name),
      Object.fromEntries(
        Object.entries(bases).map(([base, color]) => [base, toHex(composite(value, color))]),
      ),
    ]),
  );
};

/** The theme as React Native reads it: nested colours (rgba allowed), component tokens, tints. */
const nativeTheme = (theme: ThemeName) => {
  const colors = semantic[theme];
  return {
    colors,
    components: componentColors(colors),
    tints: nativeTints(theme),
    density: theme === "tv" ? "tv" : "touch",
  };
};

/** React Native only knows weights in hundreds; 650 becomes 600, 750 becomes 700. */
const nativeWeight = (weight: number) => String(Math.floor((weight + 49) / 100) * 100);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Serialises plain data as TypeScript in the shape oxfmt prints, so the file stays formatted. */
const serialise = (value: unknown, indent = ""): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map((item) => serialise(item, inner));
    const flat = `[${items.join(", ")}]`;
    return flat.length + indent.length < 70
      ? flat
      : `[\n${items.map((i) => `${inner}${i},`).join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    const name = IDENTIFIER.test(key) || /^\d+$/.test(key) ? key : JSON.stringify(key);
    return `${inner}${name}: ${serialise(item, inner)},`;
  });
  return `{\n${entries.join("\n")}\n${indent}}`;
};

/**
 * The React Native theme module. Self-contained data, so Metro bundles no token build code.
 * Translucent colours stay rgba (React Native supports it) and also come precomputed as
 * opaque hex over each base surface under `tints`, since React Native has no `color-mix`.
 */
export const buildNativeModule = (): string => {
  const themes = Object.fromEntries(themeNames.map((name) => [name, nativeTheme(name)]));
  const typeByDensity = Object.fromEntries(
    Object.entries(densities).map(([name, density]) => [
      name,
      Object.fromEntries(
        Object.entries(typeScale).map(([step, spec]) => {
          const size = spec[density.typeScale];
          const style = {
            fontFamily: fonts[spec.font].family,
            fontSize: size,
            lineHeight: Math.round(size * spec.lineHeight),
            fontWeight: nativeWeight(spec.weight),
            letterSpacing: Number((size * spec.tracking).toFixed(2)),
            uppercase: spec.uppercase,
          };
          return [step, style];
        }),
      ),
    ]),
  );
  const families = Object.fromEntries(
    Object.entries(fonts).map(([role, font]) => [role, font.family]),
  );

  return `// Generated by packages/design-tokens/scripts/generate.ts from src/tokens.ts. Do not edit.

/** A theme name: dark is the default, light follows the system, tv is dark tuned for 3 m. */
export type ThemeName = "dark" | "light" | "tv";

const dark = ${serialise(themes.dark)};

/** One theme: semantic colours, component colours, opaque tints and its default density. */
export type Theme = typeof dark;

/** Every theme. TV always uses \`tv\`; phones follow the system between \`dark\` and \`light\`. */
export const themes: Readonly<Record<ThemeName, Theme>> = {
  dark,
  light: ${serialise(themes.light, "  ")},
  tv: ${serialise(themes.tv, "  ")},
};

/** Spacing in dp, keyed by its size. */
export const space = ${serialise(space)} as const;

/** Corner radii in dp. */
export const radius = ${serialise(radius)} as const;

/** Control heights in dp per pointer, and the smallest touch target. */
export const controls = ${serialise(controls)} as const;

/** Font family names as loaded by the app. */
export const fontFamilies = ${serialise(families)} as const;

/** Densities: smallest text, smallest target, safe margin and focus width. TV values are px at 1080p. */
export const densities = ${serialise(densities)} as const;

/** Text styles per density. TV sizes are px at 1080p; convert with the screen's scale. */
export const typography = ${serialise(typeByDensity)} as const;

/** Motion with reduced variants; durations in ms, easing as cubic bezier control points. */
export const motion = ${serialise(motion)} as const;

/** The live-edge ring keyframes. */
export const pulseKeyframes = ${serialise(pulseKeyframes)} as const;

/** Focus ring sizes in dp: 2 dp ring on phone, amber fill plus 4 px ring on TV. */
export const focus = ${serialise(focus)} as const;

/** Avatar tones (\`AvatarTone\` in the domain): a fill and the ink on it, the same in every theme. */
export const avatarTones = ${serialise(avatarTones)} as const;
`;
};
