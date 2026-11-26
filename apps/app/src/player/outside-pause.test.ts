import { describe, expect, it } from "vitest";
import { pausedFromNative } from "./outside-pause.ts";

const steady = { loaded: true };

describe("pausedFromNative", () => {
  it("follows a play or a pause made outside the player", () => {
    expect(pausedFromNative({ isPlaying: true, isSeeking: false }, steady)).toBe(false);
    expect(pausedFromNative({ isPlaying: false, isSeeking: false }, steady)).toBe(true);
  });

  it("ignores seeking and loading a renewed playlist", () => {
    const stopped = { isPlaying: false, isSeeking: false };
    expect(pausedFromNative(stopped, { loaded: false })).toBeUndefined();
    expect(pausedFromNative({ isPlaying: false, isSeeking: true }, steady)).toBeUndefined();
  });
});
