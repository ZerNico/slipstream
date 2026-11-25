import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { buildNativeModule, buildTailwindCss, cssColorVars, nativeTints } from "./build.ts";
import { composite, toHex } from "./color.ts";
import { generatedFiles } from "./generated-files.ts";
import { controls, themes, typography } from "./generated/native.ts";
import { semantic, themeNames } from "./tokens.ts";

const regenerate = "run `pnpm --filter @slipstream/design-tokens generate`";

describe("generated files", () => {
  it(`tailwind.css is up to date (${regenerate})`, async () => {
    expect(await readFile(generatedFiles.tailwind, "utf8")).toBe(buildTailwindCss());
  });

  it(`native.ts is up to date (${regenerate})`, async () => {
    expect(await readFile(generatedFiles.native, "utf8")).toBe(buildNativeModule());
  });
});

/** The colour names SPEC §3.1 gives; the web uses them through Tailwind and in its CSS. */
const contract = [
  "bg",
  "bg-2",
  "surface",
  "raised",
  "sunken",
  "hover",
  "press",
  "line",
  "line-2",
  "fg",
  "fg-2",
  "fg-3",
  "fg-4",
  "brand",
  "brand-fg",
  "brand-soft",
  "on-brand",
  "live",
  "live-fg",
  "live-soft",
  "live-solid",
  "warn",
  "warn-fg",
  "warn-soft",
  "on-warn",
  "warn-ink",
  "ok",
  "ok-soft",
  "ok-fg",
  "info",
  "focus",
  "glass",
  "nav-bg",
  "sk",
  "tl-track",
  "tl-cap",
  "tl-played",
];

describe("tailwind.css", () => {
  const css = buildTailwindCss();
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`) + selector.length;
    return css.slice(start, css.indexOf("\n}", start));
  };

  it("defines the SPEC colours in dark, light (both routes) and on the cinema surface", () => {
    const blocks = [
      block(":root,\n.tv"),
      block(':root:not([data-theme="dark"])'),
      block(':root[data-theme="light"]'),
      block('[data-surface="cine"]'),
    ];
    for (const name of contract) {
      for (const scope of blocks) expect(scope).toContain(`--${name}: `);
    }
  });

  it("matches the SPEC values for both themes and the cinema surface", () => {
    const dark = block(":root,\n.tv");
    const light = block(':root[data-theme="light"]');
    const cine = block('[data-surface="cine"]');
    expect(dark).toContain("--bg: #0a0a0c;");
    expect(dark).toContain("--fg-2: #b2b1ab;");
    expect(dark).toContain("--line: rgba(255, 255, 255, 0.075);");
    expect(dark).toContain("--focus: #ffc233;");
    expect(light).toContain("--bg: #f5f4f0;");
    expect(light).toContain("--brand-fg: #8a5e00;");
    expect(light).toContain("--warn-ink: #8a3a00;");
    expect(light).toContain("--focus: #131315;");
    expect(cine).toContain("--bg: #050506;");
    expect(cine).toContain("--fg: #f6f5f1;");
    expect(cine).toContain("--live-fg: #ff7080;");
    expect(cine).toContain("--focus: #ffc233;");
    expect(cine).toContain("color-scheme: dark;");
  });

  it("keeps the static scales: radii, motion, control heights, z-index", () => {
    const dark = block(":root,\n.tv");
    expect(dark).toContain("--r-s: 8px;\n  --r-m: 12px;\n  --r-l: 18px;\n  --r-xl: 24px;");
    expect(dark).toContain("--ease: cubic-bezier(0.2, 0.8, 0.2, 1);");
    expect(dark).toContain("--t-fast: 140ms;\n  --t-med: 260ms;\n  --t-slow: 320ms;");
    expect(dark).toContain("--ctl-sm: 32px;\n  --ctl-md: 40px;\n  --ctl-lg: 48px;");
    expect(dark).toContain("--z-nav: 40;");
    expect(dark).toContain("--z-toast: 90;");
    expect(dark.replace(/\n\s+/gu, " ")).toContain('--f-ui: "Inter Variable", Inter,');
    expect(dark.split("\n").every((line) => line.length <= 100)).toBe(true);
  });

  it("grows controls under a coarse pointer and only overrides on .tv what differs", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain("--ctl-sm: 40px;");
    expect(coarse).toContain("--ctl-md: 44px;");
    const tv = block("}\n\n.tv");
    expect(tv).not.toContain("--bg:");
    expect(tv).toContain("--fg-3: #95948e;");
  });

  it("collapses motion under reduced motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("--t-fast: 0.001ms;");
    expect(reduced).toContain("--t-slow: 0.001ms;");
    expect(reduced).toContain("--animate-live-pulse: none;");
    expect(reduced).toContain("--animate-ring: none;");
  });
});

describe("tailwind.css compiled by Tailwind v4", () => {
  const tailwindDir = dirname(fileURLToPath(import.meta.resolve("tailwindcss/package.json")));
  const load = async (id: string, base: string) => {
    const path = id.startsWith("tailwindcss/")
      ? `${tailwindDir}/${id.slice("tailwindcss/".length)}`
      : fileURLToPath(generatedFiles.tailwind);
    return { path, base, content: await readFile(path, "utf8") };
  };
  const build = async (candidates: string[]) => {
    const compiler = await compile(
      '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n@import "./tokens.css";',
      { base: tailwindDir, loadStylesheet: load },
    );
    return compiler.build(candidates);
  };

  it("maps tokens and shadcn names to utilities", async () => {
    const out = await build([
      "bg-surface",
      "text-fg-2",
      "bg-primary",
      "bg-accent",
      "ring-ring",
      "border-line-2",
      "bg-brand-soft",
      "rounded-md",
      "rounded-xl",
      "font-display",
      "text-h1",
      "text-eyebrow",
      "h-ctl-md",
      "min-h-tap",
      "shadow-pop",
      "ease-standard",
      "duration-fast",
      "md:flex",
      "lg:grid",
    ]);
    expect(out).toContain("background-color: var(--surface)");
    expect(out).toContain("color: var(--fg-2)");
    expect(out).toContain("background-color: var(--primary)");
    expect(out).toContain("background-color: var(--accent)");
    expect(out).toContain("border-color: var(--line-2)");
    expect(out).toContain("border-radius: var(--r-m)");
    expect(out).toContain("border-radius: var(--r-xl)");
    expect(out).toContain("font-family: var(--f-display)");
    expect(out).toContain("font-size: clamp(26px, 3vw, 34px)");
    expect(out).toMatch(/letter-spacing: .*0\.06em/);
    expect(out).toContain("height: var(--ctl-md)");
    expect(out).toContain("min-height: var(--tap-min)");
    expect(out).toContain("var(--elev-pop)");
    expect(out).toContain("@media (width >= 768px)");
    expect(out).toContain("@media (width >= 1100px)");
  });

  it("drops Tailwind's default palette and breakpoints", async () => {
    const out = await build(["bg-red-500", "text-white", "2xl:flex"]);
    expect(out).not.toContain(".bg-red-500");
    expect(out).not.toContain(".text-white");
    expect(out).not.toContain("2xl");
  });

  it("emits the live pulse and the live-edge ring", async () => {
    const out = await build(["animate-live-pulse", "animate-ring"]);
    expect(out).toContain("@keyframes live-pulse");
    expect(out).toContain("@keyframes ring");
  });
});

describe("React Native theme", () => {
  it("sizes type per density from the SPEC roles", () => {
    expect(typography.tv.display.fontSize).toBe(80);
    expect(typography.touch.body).toEqual({
      fontFamily: "Inter",
      fontSize: 15,
      lineHeight: 23,
      fontWeight: "400",
      letterSpacing: 0,
      uppercase: false,
    });
    // React Native takes weights in hundreds only.
    expect(typography.web.h2.fontWeight).toBe("600");
    expect(typography.touch.eyebrow.uppercase).toBe(true);
  });

  it("carries the control height scale", () => {
    expect(controls.md).toEqual({ fine: 40, coarse: 44 });
    expect(controls.minTarget).toBe(44);
  });

  it("has every theme with the same shape", () => {
    expect(Object.keys(themes)).toEqual([...themeNames]);
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, item]) =>
        typeof item === "object" && item !== null
          ? keys(item).map((sub) => `${key}.${sub}`)
          : [key],
      );
    expect(keys(themes.light)).toEqual(keys(themes.dark));
    expect(keys(themes.tv)).toEqual(keys(themes.dark));
  });

  it("precomputes every translucent colour over each base as opaque hex", () => {
    for (const name of themeNames) {
      const tints = nativeTints(name);
      const colors = semantic[name];
      expect(tints["liveSoft"]?.["surface"]).toBe(
        toHex(composite(colors.status.live.subtleBg, colors.bg.surface)),
      );
      expect(tints["tlCap"]?.["canvas"]).toBe(
        toHex(composite(colors.timeline.captured, colors.bg.canvas)),
      );
      for (const byBase of Object.values(tints)) {
        expect(Object.keys(byBase)).toEqual(["canvas", "surface", "raised", "brand"]);
        for (const value of Object.values(byBase)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
    expect(themes.dark.tints.guideCellFocusMeta.brand).toBe(
      toHex(composite("rgba(26, 19, 0, 0.75)", "#FFC233")),
    );
  });

  it("covers every translucent CSS colour", () => {
    const translucent = cssColorVars
      .map(([name, get]) => [name, get(semantic.light)] as const)
      .filter(([, value]) => value.startsWith("rgba"))
      .map(([name]) => name.replaceAll(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()));
    expect(Object.keys(themes.light.tints)).toEqual(expect.arrayContaining(translucent));
  });
});
