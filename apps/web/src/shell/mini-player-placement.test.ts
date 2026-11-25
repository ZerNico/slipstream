import { describe, expect, it } from "vitest";
import {
  clampWidth,
  MINI_MAX_WIDTH,
  MINI_MIN_WIDTH,
  nearestCorner,
} from "./mini-player-placement.ts";

describe("mini player placement", () => {
  const viewport = { width: 1600, height: 900 };

  it("snaps to the corner nearest to where the card was let go", () => {
    expect(nearestCorner(1400, 800, viewport)).toBe("br");
    expect(nearestCorner(100, 800, viewport)).toBe("bl");
    expect(nearestCorner(1400, 100, viewport)).toBe("tr");
    expect(nearestCorner(100, 100, viewport)).toBe("tl");
  });

  it("keeps the width between its limits and inside the window", () => {
    expect(clampWidth(100, 1600)).toBe(MINI_MIN_WIDTH);
    expect(clampWidth(5000, 1600)).toBe(MINI_MAX_WIDTH);
    expect(clampWidth(500, 520)).toBe(480);
    expect(clampWidth(412.6, 1600)).toBe(413);
  });
});
