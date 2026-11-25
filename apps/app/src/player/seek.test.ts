import { describe, expect, it } from "vitest";
import {
  LIVE_EDGE_OFFSET,
  behindLive,
  isAtLive,
  liveTarget,
  relativeTarget,
  startTarget,
} from "./seek.ts";

// A live DVR window of 30 minutes, currently 10 minutes behind the edge.
const progress = { currentTime: 1200, seekableDuration: 1800 };

describe("seek targets", () => {
  it("starts at the beginning of the window", () => {
    expect(startTarget()).toBe(0);
  });

  it("goes live just behind the edge", () => {
    expect(liveTarget(progress)).toBe(1800 - LIVE_EDGE_OFFSET);
    expect(liveTarget({ currentTime: 0, seekableDuration: 5 })).toBe(0);
  });

  it("clamps relative seeks to the window", () => {
    expect(relativeTarget(progress, 30)).toBe(1230);
    expect(relativeTarget(progress, -2000)).toBe(0);
    expect(relativeTarget(progress, 900)).toBe(1800);
  });

  it("copes with the unknown durations players report before loading", () => {
    const unknown = { currentTime: Number.NaN, seekableDuration: Number.POSITIVE_INFINITY };
    expect(liveTarget(unknown)).toBe(0);
    expect(relativeTarget(unknown, 30)).toBe(0);
    expect(behindLive(unknown)).toBe(0);
  });
});

describe("live state", () => {
  it("measures the distance behind live", () => {
    expect(behindLive(progress)).toBe(600);
    expect(isAtLive(progress)).toBe(false);
  });

  it("counts a position near the edge as live", () => {
    expect(isAtLive({ currentTime: liveTarget(progress), seekableDuration: 1800 })).toBe(true);
  });
});
