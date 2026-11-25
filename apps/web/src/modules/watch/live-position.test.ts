import { describe, expect, it } from "vitest";
import {
  behindLive,
  clampToPlayable,
  livePoint,
  wallClockOffset,
  type PlaybackSnapshot,
} from "./live-position.ts";

const NOW = Date.UTC(2026, 10, 22, 6, 12);

/** 45 minutes captured, hls.js playing live 6 s behind the newest segment. */
const snapshot: PlaybackSnapshot = {
  currentTime: 600,
  seekableStart: 0,
  seekableEnd: 2700,
  liveSync: 2694,
  epochOffset: NOW - 2700 * 1000,
};

describe("behind live", () => {
  it("measures from the playhead to hls.js's live point", () => {
    expect(livePoint(snapshot)).toBe(2694);
    expect(behindLive(snapshot)).toBe(2094);
  });

  it("falls back to the newest second before hls.js knows the live point", () => {
    expect(behindLive({ ...snapshot, liveSync: null })).toBe(2100);
  });

  it("never goes negative", () => {
    expect(behindLive({ ...snapshot, currentTime: 2692 })).toBe(2);
    expect(behindLive({ ...snapshot, currentTime: 2699 })).toBe(0);
  });
});

describe("seeking", () => {
  it("holds seeks inside the playable range, never past live", () => {
    expect(clampToPlayable(snapshot, -20)).toBe(0);
    expect(clampToPlayable(snapshot, 99_999)).toBe(2694);
    expect(clampToPlayable({ ...snapshot, seekableStart: 120 }, 30)).toBe(120);
  });
});

describe("wallClockOffset", () => {
  it("trusts the playlist's date when it agrees with now", () => {
    const fromPlaylist = NOW - 2700 * 1000 + 4000;
    expect(wallClockOffset({ programDateOffset: fromPlaylist, seekableEnd: 2700, now: NOW })).toBe(
      fromPlaylist,
    );
  });

  it("anchors the newest second to now when the playlist's date is missing or off", () => {
    const anchored = NOW - 2700 * 1000;
    expect(wallClockOffset({ programDateOffset: null, seekableEnd: 2700, now: NOW })).toBe(
      anchored,
    );
    expect(
      wallClockOffset({ programDateOffset: anchored + 600_000, seekableEnd: 2700, now: NOW }),
    ).toBe(anchored);
  });
});
