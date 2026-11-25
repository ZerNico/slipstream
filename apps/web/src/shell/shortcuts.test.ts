// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { filterOptions, type PaletteOption } from "./palette-options.ts";
import { isTyping, shortcutFor } from "./shortcuts.ts";

const press = (
  key: string,
  modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...modifiers,
});

describe("shortcutFor (SPEC §7.2)", () => {
  it("opens the palette with ⌘K, Ctrl K and /", () => {
    expect(shortcutFor(press("k", { metaKey: true }), false)).toEqual({ kind: "palette" });
    expect(shortcutFor(press("K", { ctrlKey: true }), false)).toEqual({ kind: "palette" });
    expect(shortcutFor(press("/"), false)).toEqual({ kind: "palette" });
  });

  it("opens the shortcuts with ?", () => {
    expect(shortcutFor(press("?"), false)).toEqual({ kind: "keys" });
  });

  it("goes places with G then H, G, R, E, S (G E is Series, G S Settings)", () => {
    expect(shortcutFor(press("g"), false)).toEqual({ kind: "go-prefix" });
    expect(shortcutFor(press("h"), true)).toEqual({ kind: "go", to: "/" });
    expect(shortcutFor(press("g"), true)).toEqual({ kind: "go", to: "/guide" });
    expect(shortcutFor(press("r"), true)).toEqual({ kind: "go", to: "/recordings" });
    expect(shortcutFor(press("e"), true)).toEqual({ kind: "go", to: "/series" });
    expect(shortcutFor(press("u"), true)).toEqual({ kind: "none" });
    expect(shortcutFor(press("s"), true)).toEqual({ kind: "go", to: "/settings" });
    expect(shortcutFor(press("x"), true)).toEqual({ kind: "none" });
  });

  it("leaves other modified keys to the browser", () => {
    expect(shortcutFor(press("g", { ctrlKey: true }), false)).toEqual({ kind: "none" });
  });
});

describe("isTyping", () => {
  it("counts text fields and comboboxes as typing, a volume slider not", () => {
    const text = document.createElement("input");
    const range = document.createElement("input");
    range.type = "range";
    const area = document.createElement("textarea");
    const combo = document.createElement("div");
    combo.setAttribute("role", "combobox");
    expect(isTyping(text)).toBe(true);
    expect(isTyping(area)).toBe(true);
    expect(isTyping(combo)).toBe(true);
    expect(isTyping(range)).toBe(false);
    expect(isTyping(document.createElement("button"))).toBe(false);
  });
});

/** A palette option for the filter tests. */
const option = (group: PaletteOption["group"], title: string, meta?: string): PaletteOption => ({
  id: `${group}-${title}`,
  group,
  title,
  ...(meta === undefined ? {} : { meta }),
  icon: {} as PaletteOption["icon"],
  run: () => undefined,
});

describe("filterOptions", () => {
  const options = [
    option("series", "Formel 1 live"),
    option("channels", "Sky Sport F1 HD", "12"),
    option("actions", "Go to Guide"),
    option("recordings", "Live F1: Qualifying"),
  ];

  it("shows the actions for an empty query", () => {
    expect(filterOptions(options, "").map((entry) => entry.title)).toEqual(["Go to Guide"]);
  });

  it("matches title and meta case-insensitively, groups in a fixed order", () => {
    expect(filterOptions(options, "f1").map((entry) => entry.group)).toEqual([
      "channels",
      "recordings",
    ]);
    expect(filterOptions(options, "formel").map((entry) => entry.title)).toEqual(["Formel 1 live"]);
    expect(filterOptions(options, "12").map((entry) => entry.title)).toEqual(["Sky Sport F1 HD"]);
  });
});
