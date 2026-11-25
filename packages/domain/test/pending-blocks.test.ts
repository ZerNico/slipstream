import { describe, expect, it } from "vitest";
import { guideDays, pendingBlocks } from "../src/guide-timeline.ts";
import { HOUR, MINUTE } from "../src/time.ts";

const now = Date.UTC(2026, 10, 24, 10);
const days = guideDays(now, "Europe/Berlin", 3);
const [today, tomorrow] = days;
if (today === undefined || tomorrow === undefined) throw new Error("no days");
const window = { from: today.start, to: today.start + 3 * 24 * HOUR };
const ppm = 4;
const blockMs = 90 * MINUTE;

describe("pendingBlocks", () => {
  it("cuts a loading day near the view into blocks from its start", () => {
    const near = { from: tomorrow.start - HOUR, to: tomorrow.start + 3 * HOUR };
    // From midnight (the day's start, not before it) to three hours on: 90 minutes, 90 minutes.
    expect(pendingBlocks({ days: [tomorrow], window, ppm, near, blockMs })).toEqual([
      { x: 24 * 60 * ppm + 2, width: 90 * ppm - 4 },
      { x: (24 * 60 + 90) * ppm + 2, width: 90 * ppm - 4 },
    ]);
  });

  it("staggers a row by the offset: a short first block, then whole ones", () => {
    const near = { from: tomorrow.start, to: tomorrow.start + 2 * HOUR };
    expect(
      pendingBlocks({ days: [tomorrow], window, ppm, near, blockMs: HOUR, offsetMs: HOUR / 2 }),
    ).toEqual([
      { x: 24 * 60 * ppm + 2, width: 30 * ppm - 4 },
      { x: (24 * 60 + 30) * ppm + 2, width: 60 * ppm - 4 },
      { x: (24 * 60 + 90) * ppm + 2, width: 60 * ppm - 4 },
    ]);
  });

  it("draws nothing for a loading day away from the view", () => {
    const near = { from: today.start, to: today.start + 4 * HOUR };
    expect(pendingBlocks({ days: [tomorrow], window, ppm, near, blockMs })).toEqual([]);
  });
});
