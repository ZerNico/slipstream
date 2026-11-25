import { describe, expect, it } from "vitest";
import {
  behindLive,
  clampToPlayable,
  clockAnchors,
  clockGaps,
  liveClock,
  livePoint,
  mediaAt,
  wallAt,
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

describe("a live window with a gap", () => {
  const MINUTE = 60_000;
  /** Ten minutes captured, a 50-minute gap, then 20 minutes up to now; 6 s segments. */
  const segments = [
    ...Array.from({ length: 100 }, (_, index) => ({
      start: index * 6,
      duration: 6,
      programDateTime: NOW - 80 * MINUTE + index * 6000,
    })),
    ...Array.from({ length: 200 }, (_, index) => ({
      start: 600 + index * 6,
      duration: 6,
      programDateTime: NOW - 20 * MINUTE + index * 6000,
    })),
  ];
  const anchors = clockAnchors(segments);
  const clock = liveClock({ anchors, seekableEnd: 1800, now: NOW });
  const gapped: PlaybackSnapshot = {
    currentTime: 1794,
    seekableStart: 0,
    seekableEnd: 1800,
    liveSync: 1794,
    ...clock,
  };

  it("anchors each stretch where its dates start", () => {
    expect(anchors).toEqual([
      { media: 0, wall: NOW - 80 * MINUTE },
      { media: 600, wall: NOW - 20 * MINUTE },
    ]);
    expect(clock.clock).toEqual(anchors);
  });

  it("shows both stretches at their own clock times and the gap between them", () => {
    expect(wallAt(gapped, 0)).toBe(NOW - 80 * MINUTE);
    expect(wallAt(gapped, 300)).toBe(NOW - 75 * MINUTE);
    expect(wallAt(gapped, 1800)).toBe(NOW);
    expect(clockGaps(gapped)).toEqual([{ start: NOW - 70 * MINUTE, end: NOW - 20 * MINUTE }]);
  });

  it("seeks by clock time, and from inside the gap to where capturing started again", () => {
    expect(mediaAt(gapped, NOW - 75 * MINUTE)).toBe(300);
    expect(mediaAt(gapped, NOW - 40 * MINUTE)).toBe(600);
    expect(mediaAt(gapped, NOW - 10 * MINUTE)).toBe(1200);
  });

  it("keeps one clock when the dates run on without a jump", () => {
    const steady = clockAnchors(segments.slice(100));
    expect(steady).toHaveLength(1);
    const single = liveClock({ anchors: steady, seekableEnd: 1200, now: NOW });
    expect(single.clock).toBeUndefined();
    expect(clockGaps({ ...snapshot, ...single })).toEqual([]);
  });

  it("falls back to now when the newest stretch's dates are off", () => {
    const off = liveClock({ anchors, seekableEnd: 1800 + 600, now: NOW });
    expect(off).toEqual({ epochOffset: NOW - 2400 * 1000 });
  });
});
