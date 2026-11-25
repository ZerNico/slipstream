import { describe, expect, it } from "vitest";
import { initialCursor, step } from "./cursor.ts";
import { at, hourly, sampleGuide } from "./fixtures.ts";
import { defaultGuideConfig, makeGuide } from "./guide.ts";
import { guideWindow, slotTicks } from "./window.ts";
import { HOUR } from "@slipstream/domain";

const config = defaultGuideConfig;
const guide = sampleGuide();
const NOW = at("06:12");

describe("guideWindow", () => {
  it("renders the viewport rows plus overscan below the top", () => {
    const window = guideWindow(guide, config, initialCursor(guide, config, NOW));
    expect(window).toMatchObject({ firstRow: 0, lastRow: 9 });
    expect(window.rows.map((row) => row.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("renders overscan on both sides once scrolled", () => {
    const cursor = step(guide, config, initialCursor(guide, config, NOW), {
      _tag: "Channel",
      number: 210,
    });
    const window = guideWindow(guide, config, cursor);
    expect(window).toMatchObject({ firstRow: 7, lastRow: 18 });
  });

  it("lists only programmes overlapping the time window, in order", () => {
    const cursor = initialCursor(guide, config, NOW);
    const window = guideWindow(guide, config, cursor, { rowOverscan: 0, timeOverscan: 0 });
    expect(window).toMatchObject({ from: at("05:30"), to: at("08:30") });
    const ard = window.rows[0]?.cells.map((cell) => cell.programme.id);
    expect(ard).toEqual(["ard@04:55", "ard@06:20", "ard@06:30", "ard@08:00"]);
    const hourlyRow = window.rows[5]?.cells.map((cell) => cell.index);
    expect(hourlyRow).toEqual([5, 6, 7, 8]);
  });

  it("flags cells clipped by the viewport and the focused cell", () => {
    const cursor = initialCursor(guide, config, NOW);
    const cells = guideWindow(guide, config, cursor).rows[0]?.cells ?? [];
    const polizeiruf = cells.find((cell) => cell.programme.id === "ard@04:55");
    expect(polizeiruf).toMatchObject({ clippedStart: true, clippedEnd: false, focused: true });
    const sportschau = cells.find((cell) => cell.programme.id === "ard@08:00");
    expect(sportschau).toMatchObject({ clippedStart: false, clippedEnd: true, focused: false });
    const focused = guideWindow(guide, config, cursor).rows.flatMap((row) =>
      row.cells.filter((cell) => cell.focused),
    );
    expect(focused).toHaveLength(1);
  });

  it("includes the empty channel as a row without cells", () => {
    const window = guideWindow(guide, config, initialCursor(guide, config, NOW));
    expect(window.rows[2]).toMatchObject({ row: 2, cells: [] });
  });

  it("puts ruler ticks on every slot inside the window", () => {
    const cursor = initialCursor(guide, config, NOW);
    const window = guideWindow(guide, config, cursor, { rowOverscan: 0, timeOverscan: HOUR });
    expect(window.ticks).toHaveLength(10);
    expect(window.ticks[0]).toBe(at("04:30"));
    expect(window.ticks.at(-1)).toBe(at("09:00"));
  });

  it("stays small for a large guide", () => {
    const big = makeGuide(
      Array.from({ length: 1000 }, (_, index) => hourly(`c${index}`, index, 24 * 7)),
    );
    const cursor = step(big, config, initialCursor(big, config, at("30:00")), {
      _tag: "Channel",
      number: 500,
    });
    const window = guideWindow(big, config, cursor);
    expect(window.rows).toHaveLength(config.visibleRows + 4);
    const cells = window.rows.reduce((sum, row) => sum + row.cells.length, 0);
    expect(cells).toBe(window.rows.length * 6);
  });
});

describe("slotTicks", () => {
  it("includes the start boundary and excludes the end", () => {
    expect(slotTicks(at("06:00"), at("07:00"), HOUR / 2)).toEqual([at("06:00"), at("06:30")]);
    expect(slotTicks(at("06:10"), at("06:20"), HOUR / 2)).toEqual([]);
  });
});
