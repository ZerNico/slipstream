import { type GuideProgramme, type WindowCell } from "./core/index.ts";
import { describe, expect, it } from "vitest";
import { cellRect, guideLayout, showsTimeLine } from "./layout.ts";
import { HOUR, MINUTE } from "@slipstream/domain";

// A 1080p TV at xhdpi is 960 x 540 dp; the guide is 80 em wide, so 12 dp per em.
const layout = guideLayout(960, 540, 12, 3 * HOUR);

const cell = (
  start: number,
  end: number,
  flags: Partial<Pick<WindowCell, "clippedStart" | "focused">> = {},
): WindowCell => {
  const programme: GuideProgramme = { id: "p", start, end };
  return { index: 0, programme, clippedStart: false, clippedEnd: false, focused: false, ...flags };
};

describe("guideLayout", () => {
  it("uses the mockup's measurements in em", () => {
    expect(layout).toMatchObject({
      headerHeight: 186,
      inset: 48,
      channelWidth: 180,
      rowHeight: expect.closeTo(51.6) as number,
      trackWidth: 732,
    });
  });

  it("fits whole rows below the header and ruler", () => {
    // 540 - 186 - 28.8 leaves 325.2 dp, six rows of 51.6.
    expect(layout.visibleRows).toBe(6);
    expect(guideLayout(960, 100, 12, HOUR).visibleRows).toBe(1);
  });

  it("maps the visible span onto the track width", () => {
    expect(layout.pxPerMs * 3 * HOUR).toBeCloseTo(732);
  });
});

describe("cellRect", () => {
  const origin = 0;

  it("places cells by time from the origin with a gap between neighbours", () => {
    const rect = cellRect(cell(HOUR, 2 * HOUR), layout, origin, 0);
    expect(rect.left).toBeCloseTo(244);
    expect(rect.width).toBeCloseTo(244 - 3.6);
    expect(rect.textInset).toBe(0);
  });

  it("widens a focused short cell so the title fits", () => {
    const rect = cellRect(cell(0, 10 * MINUTE, { focused: true }), layout, origin, 0);
    expect(rect.width).toBe(layout.focusMinWidth);
  });

  it("keeps a clipped cell's title inside the viewport", () => {
    const viewStart = HOUR;
    const rect = cellRect(cell(0, 3 * HOUR, { clippedStart: true }), layout, origin, viewStart);
    expect(rect.textInset).toBeCloseTo(244);
  });

  it("never pushes the title past the end of the cell", () => {
    const viewStart = 50 * MINUTE;
    const rect = cellRect(cell(0, HOUR, { clippedStart: true }), layout, origin, viewStart);
    expect(rect.textInset).toBeLessThanOrEqual(rect.width - 6 * layout.em);
    expect(rect.textInset).toBeGreaterThanOrEqual(0);
  });
});

describe("showsTimeLine", () => {
  it("drops the time line for programmes under 20 minutes unless focused", () => {
    expect(showsTimeLine(cell(0, 19 * MINUTE))).toBe(false);
    expect(showsTimeLine(cell(0, 20 * MINUTE))).toBe(true);
    expect(showsTimeLine(cell(0, 5 * MINUTE, { focused: true }))).toBe(true);
  });
});
