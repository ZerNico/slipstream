import { describe, expect, it } from "vitest";
import { pauseAway, pipArmed } from "./pip.ts";

describe("pipArmed", () => {
  it("keeps a playing phone player going into the small window, never a TV or a paused one", () => {
    expect(pipArmed(false, false)).toBe(true);
    expect(pipArmed(false, true)).toBe(false);
    expect(pipArmed(true, false)).toBe(false);
  });
});

describe("pauseAway", () => {
  it("plays on in the window, and in the foreground", () => {
    expect(pauseAway("background", true)).toBe(false);
    expect(pauseAway("active", false)).toBe(false);
  });

  it("pauses in the background without a window: none opened, or it was closed", () => {
    expect(pauseAway("background", false)).toBe(true);
  });
});
