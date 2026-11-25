import { cellsInView, gridView, sameGridView } from "../src/guide-timeline.ts";
import { describe, expect, it } from "vitest";

/** Side-by-side cells, 100 px each with no gaps: cell i covers i*100 to i*100+100. */
const cells = Array.from({ length: 50 }, (_, index) => ({ x: index * 100, width: 100 }));

/** The view of a 1000 × 500 grid scrolled to `left`, `top`. */
const at = (left: number, top = 0) => gridView({ left, top, width: 1000, height: 500 }, 78, 10);

describe("grid view", () => {
  it("draws the rows in view and a block beyond, snapped to blocks", () => {
    const view = gridView({ left: 0, top: 780, width: 1000, height: 780 }, 78, 300);
    // Rows 10 to 20 show; four more each side, snapped to fours.
    expect(view.rowFrom).toBe(4);
    expect(view.rowTo).toBe(24);
  });

  it("stays inside the rows there are", () => {
    const view = gridView({ left: 0, top: 0, width: 1000, height: 780 }, 78, 6);
    expect(view.rowFrom).toBe(0);
    expect(view.rowTo).toBe(6);
  });

  it("reaches a viewport either side, snapped to half viewports", () => {
    const view = gridView({ left: 5000, top: 0, width: 1000, height: 500 }, 78, 10);
    expect(view.xFrom).toBe(4000);
    expect(view.xTo).toBe(7000);
    // A little further is the same view, so scrolling renders only now and then.
    expect(sameGridView(at(5100), at(5300, 30))).toBe(true);
    expect(sameGridView(at(5100), at(5600))).toBe(false);
  });

  it("never starts before the grid", () => {
    expect(gridView({ left: 100, top: 0, width: 1000, height: 500 }, 78, 10).xFrom).toBe(0);
  });
});

describe("cells in view", () => {
  it("finds the cells reaching into the stretch", () => {
    // 250..640 touches cells 2 (200-300) to 6 (600-700).
    expect(cellsInView(cells, 250, 640)).toEqual({ from: 2, to: 7 });
  });

  it("finds none past the end or in an empty row", () => {
    expect(cellsInView(cells, 9000, 9500)).toEqual({ from: 50, to: 50 });
    expect(cellsInView([], 0, 500)).toEqual({ from: 0, to: 0 });
  });

  it("takes every cell when the stretch covers the row", () => {
    expect(cellsInView(cells, 0, 1e9)).toEqual({ from: 0, to: 50 });
  });
});
