import { describe, expect, it } from "vitest";
import { composite, contrast, type Rgba } from "./color.ts";
import { cine, componentColors, type SemanticColors, semantic } from "./tokens.ts";

/** WCAG 2 AA: 4.5 for text, 3 for large text and non-text marks (focus, fills, dots). */
const TEXT = 4.5;
const NON_TEXT = 3;
/** Key pairs must clear the minimum by this much, so rounding in a renderer cannot sink them. */
const MARGIN = 0.1;

/** Every surface a colour set is checked on: the three themes and the cinema surface. */
type Scope = "dark" | "light" | "tv" | "cine";
const scopes: Readonly<Record<Scope, SemanticColors>> = { ...semantic, cine };
const allScopes: readonly Scope[] = ["dark", "light", "tv", "cine"];

interface Pair {
  readonly name: string;
  readonly fg: (c: SemanticColors) => string;
  readonly bg: (c: SemanticColors) => Rgba | string;
  readonly min: number;
  readonly scopes?: readonly Scope[];
}

/** Text is checked on the page, on panels and on raised cells. */
const surfaces = [
  ["bg", (c: SemanticColors) => c.bg.canvas],
  ["surface", (c: SemanticColors) => c.bg.surface],
] as const;

const onSurfaces = (name: string, fg: Pair["fg"], min: number, only?: readonly Scope[]): Pair[] =>
  surfaces.map(([surface, bg]) => ({
    name: `${name} on ${surface}`,
    fg,
    bg,
    min,
    ...(only ? { scopes: only } : {}),
  }));

/** Badge text on its translucent background, as painted over a panel. */
const onSoft = (
  name: string,
  fg: Pair["fg"],
  soft: (c: SemanticColors) => string,
  only?: readonly Scope[],
): Pair => ({
  name: `${name} on its soft badge`,
  fg,
  bg: (c) => composite(soft(c), c.bg.surface),
  min: TEXT,
  ...(only ? { scopes: only } : {}),
});

const keyPairs: Pair[] = [
  ...onSurfaces("fg", (c) => c.fg.default, TEXT),
  ...onSurfaces("fg-2", (c) => c.fg.muted, TEXT),
  // SPEC §3.2: fg-3 is meta text on the page and panels; it must reach AA there.
  ...onSurfaces("fg-3", (c) => c.fg.subtle, TEXT),
  ...onSurfaces("brand-fg", (c) => c.brand.text, TEXT),
  ...onSurfaces("live-fg", (c) => c.status.live.text, TEXT),
  ...onSurfaces("ok-fg", (c) => c.status.ok.text, TEXT),
  ...onSurfaces("warn-fg", (c) => c.status.warn.text, TEXT),
  ...onSurfaces("info-fg", (c) => c.status.info.text, TEXT),
  {
    name: "fg-2 on raised (guide cell meta)",
    fg: (c) => c.fg.muted,
    bg: (c) => c.bg.raised,
    min: TEXT,
  },
  // Captions sit on raised cells, sheets and inputs (bg-2) and wells too, not only on panels.
  {
    name: "fg-3 on raised (captions on guide cells, hover rows)",
    fg: (c) => c.fg.subtle,
    bg: (c) => c.bg.raised,
    min: TEXT,
  },
  {
    name: "fg-3 on bg-2 (captions in sheets and inputs)",
    fg: (c) => c.fg.subtle,
    bg: (c) => c.bg.subtle,
    min: TEXT,
  },
  {
    name: "fg-3 on sunken (captions in wells)",
    fg: (c) => c.fg.subtle,
    bg: (c) => c.bg.sunken,
    min: TEXT,
  },
  { name: "on-brand on brand", fg: (c) => c.brand.onSolid, bg: (c) => c.brand.solid, min: TEXT },
  {
    name: "white on live-solid (Rec, Live, Delete)",
    fg: (c) => c.status.live.onSolid,
    bg: (c) => c.status.live.solid,
    min: TEXT,
  },
  {
    name: "on-warn on warn (nav problem count)",
    fg: (c) => c.status.warn.onSolid,
    bg: (c) => c.status.warn.solid,
    min: TEXT,
  },
  onSoft(
    "live-fg (Rec badge)",
    (c) => c.status.live.text,
    (c) => c.status.live.subtleBg,
  ),
  onSoft(
    "ok-fg (Will record)",
    (c) => c.status.ok.text,
    (c) => c.status.ok.subtleBg,
  ),
  onSoft(
    "warn-ink (Conflict)",
    (c) => c.status.warn.ink,
    (c) => c.status.warn.subtleBg,
  ),
  onSoft(
    "brand-fg (Scheduled)",
    (c) => c.brand.text,
    (c) => c.brand.soft,
  ),
  onSoft(
    "fg on brand-soft (selected weekday)",
    (c) => c.fg.default,
    (c) => c.brand.soft,
  ),
  {
    name: "warn-ink on the tinted conflict row",
    fg: (c) => c.status.warn.ink,
    bg: (c) => componentColors(c).row.conflictBg,
    min: TEXT,
  },
  {
    name: "guide cell meta on a focused cell",
    fg: (c) => componentColors(c).guideCell.focusMeta,
    bg: (c) => c.brand.solid,
    min: TEXT,
  },
  // Non-text: the focus ring, the playhead and live dot must stand out from the page.
  ...onSurfaces("focus ring", (c) => c.focus.ring, NON_TEXT),
  ...onSurfaces("live dot", (c) => c.status.live.indicator, NON_TEXT),
  ...onSurfaces("brand fill (playhead, primary)", (c) => c.brand.solid, NON_TEXT, [
    "dark",
    "tv",
    "cine",
  ]),
  {
    name: "timeline played against captured",
    fg: (c) => c.timeline.played,
    bg: (c) => composite(c.timeline.captured, c.bg.surface),
    min: NON_TEXT,
  },
];

/**
 * SPEC §3.1 says the light theme's warn-ink reaches at least 5.9:1 on the orange-tinted
 * conflict row and ok-fg 5.9:1 on white. Held here so a token change cannot quietly drop them.
 */
const specMinimums: Pair[] = [
  {
    name: "warn-ink on the conflict row (light)",
    fg: (c) => c.status.warn.ink,
    bg: (c) => componentColors(c).row.conflictBg,
    min: 5.9,
    scopes: ["light"],
  },
  {
    name: "ok-fg on white (light)",
    fg: (c) => c.status.ok.text,
    bg: (c) => c.bg.surface,
    min: 5.9,
    scopes: ["light"],
  },
  {
    name: "on-warn on warn (dark, 8:1)",
    fg: (c) => c.status.warn.onSolid,
    bg: (c) => c.status.warn.solid,
    min: 8,
    scopes: ["dark"],
  },
];

const failures = (pairs: readonly Pair[], margin: number) =>
  allScopes.flatMap((scope) =>
    pairs
      .filter((pair) => !pair.scopes || pair.scopes.includes(scope))
      .map((pair) => {
        const colors = scopes[scope];
        return { pair, ratio: contrast(pair.fg(colors), pair.bg(colors)) };
      })
      .filter(({ pair, ratio }) => ratio < pair.min + margin)
      .map(
        ({ pair, ratio }) =>
          `${scope}: ${pair.name} is ${ratio.toFixed(3)}, needs ${pair.min + margin}`,
      ),
  );

describe("WCAG contrast", () => {
  it(`key pairs clear AA by at least ${MARGIN} in both themes and on the cinema surface`, () => {
    expect(failures(keyPairs, MARGIN)).toEqual([]);
  });

  it("holds the minimums SPEC §3.1 quotes", () => {
    expect(failures(specMinimums, 0)).toEqual([]);
  });

  it("keeps fg-4 for decoration: it is not text-safe, so nothing may use it for text", () => {
    // If fg-4 ever reaches AA it should become fg-3; this guards the four-step meaning.
    for (const scope of allScopes) {
      const c = scopes[scope];
      expect(contrast(c.fg.faint, c.bg.canvas)).toBeLessThan(TEXT);
    }
  });

  it("catches a pair that falls short", () => {
    const grey: Pair = { name: "grey", fg: () => "#777777", bg: () => "#FFFFFF", min: TEXT };
    expect(failures([grey], 0)).toHaveLength(allScopes.length);
  });
});
