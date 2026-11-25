import { describe, expect, it } from "vitest";
import {
  closeMode,
  openMode,
  overlayValue,
  readOverlay,
  sameOverlay,
  validateOverlaySearch,
  withOverlay,
} from "./overlay-state.ts";

describe("readOverlay", () => {
  it("reads sheets and dialogs with an argument after the colon", () => {
    expect(readOverlay({ sheet: "prog:42" })).toEqual({ kind: "sheet", name: "prog", arg: "42" });
    expect(readOverlay({ dlg: "invite:g-7" })).toEqual({ kind: "dlg", name: "invite", arg: "g-7" });
    expect(readOverlay({ dlg: "cmdk" })).toEqual({ kind: "dlg", name: "cmdk" });
  });

  it("reads the watch choice's recording id whole, colons included", () => {
    expect(readOverlay({ choice: "rec:2026:q" })).toEqual({ kind: "choice", name: "rec:2026:q" });
  });

  it("finds nothing without an overlay param", () => {
    expect(readOverlay({})).toBeNull();
    expect(readOverlay({ sheet: "" })).toBeNull();
  });
});

describe("withOverlay", () => {
  it("keeps the page's own params and sets exactly one overlay", () => {
    const search = { view: "channels", day: "1", dlg: "filter" };
    expect(withOverlay(search, { kind: "sheet", name: "prog", arg: "9" })).toEqual({
      view: "channels",
      day: "1",
      sheet: "prog:9",
    });
  });

  it("drops every overlay param when closing", () => {
    expect(withOverlay({ q: "tatort", choice: "r-1", sheet: "log" }, null)).toEqual({
      q: "tatort",
    });
  });

  it("round-trips through the URL value", () => {
    const overlay = { kind: "dlg", name: "pin", arg: "mara" } as const;
    expect(readOverlay(withOverlay({}, overlay))).toEqual(overlay);
    expect(overlayValue({ kind: "choice", name: "r-q" })).toBe("r-q");
  });
});

describe("history behaviour (SPEC §11)", () => {
  it("pushes when nothing is open and replaces when one overlay opens another", () => {
    expect(openMode(null)).toBe("push");
    expect(openMode({ kind: "dlg", name: "account" })).toBe("replace");
  });

  it("goes back when this page pushed the overlay, replaces when it came from a deep link", () => {
    expect(closeMode(true)).toBe("back");
    expect(closeMode(false)).toBe("replace");
  });

  it("compares overlays by kind and value", () => {
    expect(
      sameOverlay(
        { kind: "sheet", name: "prog", arg: "1" },
        { kind: "sheet", name: "prog", arg: "1" },
      ),
    ).toBe(true);
    expect(
      sameOverlay(
        { kind: "sheet", name: "prog", arg: "1" },
        { kind: "sheet", name: "prog", arg: "2" },
      ),
    ).toBe(false);
    expect(sameOverlay(null, null)).toBe(true);
    expect(sameOverlay({ kind: "dlg", name: "cmdk" }, null)).toBe(false);
  });
});

describe("validateOverlaySearch", () => {
  it("keeps text and numeric overlay params and drops everything else", () => {
    expect(
      validateOverlaySearch({ sheet: "prog:1", choice: 42, dlg: "", view: "channels" }),
    ).toEqual({
      sheet: "prog:1",
      choice: "42",
    });
  });
});
