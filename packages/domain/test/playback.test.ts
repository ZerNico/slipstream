import { describe, expect, it } from "vitest";
import {
  fitAfterPinch,
  isWatched,
  liveEta,
  playbackSpeeds,
  progressSaveIntervalMs,
  recordingProgress,
  stepSpeed,
} from "../src/playback.ts";

describe("playback speed", () => {
  it("offers the menu's speeds, slowest first", () => {
    expect(playbackSpeeds).toEqual([0.75, 1, 1.25, 1.5, 2]);
  });

  it("steps through the menu's speeds and holds at the ends", () => {
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(2, 1)).toBe(2);
    expect(stepSpeed(0.75, -1)).toBe(0.75);
    expect(stepSpeed(1.4, 1)).toBe(2);
  });

  it("says when 1.25× reaches live: now plus the gap over the extra speed", () => {
    const now = 1_000_000;
    expect(liveEta({ now, behindMs: 300_000, speed: 1.25 })).toBe(now + 1_200_000);
    expect(liveEta({ now, behindMs: 300_000, speed: 1 })).toBeUndefined();
    expect(liveEta({ now, behindMs: 0, speed: 2 })).toBeUndefined();
  });

  it("drops the ETA when it falls after the recording window", () => {
    expect(
      liveEta({ now: 0, behindMs: 600_000, speed: 1.25, windowEnd: 1_000_000 }),
    ).toBeUndefined();
    expect(liveEta({ now: 0, behindMs: 600_000, speed: 2, windowEnd: 1_000_000 })).toBe(600_000);
  });
});

describe("isWatched", () => {
  it("counts a finished recording watched in its last minute, a running one never", () => {
    expect(isWatched({ finished: true, leftMs: 59_000 })).toBe(true);
    expect(isWatched({ finished: true, leftMs: 60_000 })).toBe(false);
    expect(isWatched({ finished: false, leftMs: 0 })).toBe(false);
  });
});

describe("recordingProgress", () => {
  it("rounds the position and marks a finished recording watched in its last minute", () => {
    expect(
      recordingProgress({ positionMs: 3_570_400.6, durationMs: 3_600_000, state: "completed" }),
    ).toEqual({ positionMillis: 3_570_401, watched: true });
    expect(
      recordingProgress({ positionMs: 1_000, durationMs: 3_600_000, state: "incomplete" }),
    ).toEqual({ positionMillis: 1_000, watched: false });
    expect(
      recordingProgress({ positionMs: 3_599_000, durationMs: 3_600_000, state: "failed" }).watched,
    ).toBe(true);
  });

  it("never marks a running, scheduled or unknown recording watched", () => {
    for (const state of ["recording", "scheduled", undefined] as const) {
      expect(recordingProgress({ positionMs: 3_600_000, durationMs: 3_600_000, state })).toEqual({
        positionMillis: 3_600_000,
        watched: false,
      });
    }
  });

  it("stores 0 and not watched while the player has no position or length yet", () => {
    expect(
      recordingProgress({ positionMs: Number.NaN, durationMs: Number.NaN, state: "completed" }),
    ).toEqual({ positionMillis: 0, watched: false });
    expect(
      recordingProgress({ positionMs: -50, durationMs: 3_600_000, state: "completed" })
        .positionMillis,
    ).toBe(0);
  });

  it("saves every 15 seconds", () => {
    expect(progressSaveIntervalMs).toBe(15_000);
  });
});

describe("fitAfterPinch", () => {
  it("fills on a pinch out, fits on a pinch in, and keeps the picture on a small one", () => {
    expect(fitAfterPinch("fit", 1.4)).toBe("fill");
    expect(fitAfterPinch("fill", 0.7)).toBe("fit");
    expect(fitAfterPinch("fit", 1.05)).toBe("fit");
    expect(fitAfterPinch("fill", 0.95)).toBe("fill");
  });
});
