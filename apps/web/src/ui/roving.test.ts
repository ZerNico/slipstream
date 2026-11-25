import { describe, expect, it } from "vitest";
import { rovingIndex } from "./roving.ts";

describe("rovingIndex", () => {
  it("moves with the arrows and wraps", () => {
    expect(rovingIndex(0, 3, "ArrowDown")).toBe(1);
    expect(rovingIndex(2, 3, "ArrowDown")).toBe(0);
    expect(rovingIndex(0, 3, "ArrowUp")).toBe(2);
    expect(rovingIndex(1, 3, "Home")).toBe(0);
    expect(rovingIndex(1, 3, "End")).toBe(2);
    expect(rovingIndex(1, 3, "Enter")).toBeUndefined();
    expect(rovingIndex(0, 0, "ArrowDown")).toBeUndefined();
  });

  it("enters a list nothing in it has yet at either end", () => {
    expect(rovingIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(rovingIndex(-1, 3, "ArrowUp")).toBe(2);
  });
});
