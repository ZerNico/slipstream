import { describe, expect, it } from "vitest";
import { pauseOnPipExit, pipArmed, resumeAfterPipExit } from "./pip.ts";

describe("pipArmed", () => {
  it("keeps a playing phone player going into the small window, never a TV or a paused one", () => {
    expect(pipArmed(false, false)).toBe(true);
    expect(pipArmed(false, true)).toBe(false);
    expect(pipArmed(true, false)).toBe(false);
  });
});

describe("pauseOnPipExit", () => {
  it("pauses when the window goes while the app is in the background (it was closed)", () => {
    expect(pauseOnPipExit("background")).toBe(true);
    expect(pauseOnPipExit("inactive")).toBe(true);
  });

  it("plays on when the app is already in the foreground (it was expanded)", () => {
    expect(pauseOnPipExit("active")).toBe(false);
  });
});

describe("resumeAfterPipExit", () => {
  it("resumes when the app comes back right after the window went", () => {
    expect(resumeAfterPipExit(1000, 1500)).toBe(true);
  });

  it("stays paused when it comes back later, or nothing was paused for the window", () => {
    expect(resumeAfterPipExit(1000, 60_000)).toBe(false);
    expect(resumeAfterPipExit(undefined, 1500)).toBe(false);
  });
});
