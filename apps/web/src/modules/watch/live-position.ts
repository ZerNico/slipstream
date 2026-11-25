/** What the player knows at one moment, in media seconds unless noted. */
export interface PlaybackSnapshot {
  readonly currentTime: number;
  /** The playable range; for a growing playlist it starts at the first segment. */
  readonly seekableStart: number;
  readonly seekableEnd: number;
  /** Where hls.js plays "live": a few segments behind the newest one. Null before it knows. */
  readonly liveSync: number | null;
  /** Wall-clock epoch ms of media time 0, so media times can be shown as clock times. */
  readonly epochOffset: number;
  /**
   * Where each stretch of the playlist sits on the wall clock, when its PROGRAM-DATE-TIME jumps
   * (a live channel that stopped and started again: nothing was captured in between). Without
   * it, the whole playlist follows `epochOffset`.
   */
  readonly clock?: readonly ClockAnchor[];
}

/** From media second `media` on (until the next anchor), the wall clock reads `wall` ms on. */
export interface ClockAnchor {
  readonly media: number;
  readonly wall: number;
}

/** Wall-clock jumps up to this long between segments are jitter, not a gap (the server's tolerance). */
const CLOCK_TOLERANCE_MS = 1000;

/**
 * The stretches of a playlist on the wall clock, from its segments' media starts (seconds) and
 * PROGRAM-DATE-TIMEs: one anchor where it begins and one wherever the clock jumps. Empty when
 * the playlist carries no dates.
 */
export const clockAnchors = (
  segments: readonly {
    readonly start: number;
    readonly duration: number;
    readonly programDateTime: number | null;
  }[],
): ClockAnchor[] => {
  const anchors: ClockAnchor[] = [];
  for (const segment of segments) {
    if (segment.programDateTime === null) continue;
    const last = anchors.at(-1);
    const expected = last === undefined ? null : last.wall + (segment.start - last.media) * 1000;
    if (expected === null || Math.abs(segment.programDateTime - expected) > CLOCK_TOLERANCE_MS) {
      anchors.push({ media: segment.start, wall: segment.programDateTime });
    }
  }
  return anchors;
};

/**
 * The clock of a live playlist: its own dates when the newest stretch agrees with now (see
 * {@link wallClockOffset}), with an anchor per stretch; otherwise one offset that puts its
 * newest second at now.
 */
export const liveClock = (input: {
  readonly anchors: readonly ClockAnchor[];
  readonly seekableEnd: number;
  readonly now: number;
}): Pick<PlaybackSnapshot, "epochOffset" | "clock"> => {
  const newest = input.anchors.at(-1);
  const programDateOffset = newest === undefined ? null : newest.wall - newest.media * 1000;
  const epochOffset = wallClockOffset({
    programDateOffset,
    seekableEnd: input.seekableEnd,
    now: input.now,
  });
  return epochOffset === programDateOffset && input.anchors.length > 1
    ? { epochOffset, clock: input.anchors }
    : { epochOffset };
};

/** The anchor whose stretch holds media second `seconds` (the first one before it starts). */
const anchorAt = (clock: readonly ClockAnchor[], seconds: number): number => {
  let index = 0;
  while (index + 1 < clock.length && (clock[index + 1]?.media ?? Infinity) <= seconds) index += 1;
  return index;
};

/** Media seconds as wall-clock epoch ms. */
export const wallAt = (snapshot: PlaybackSnapshot, seconds: number): number => {
  const anchor = snapshot.clock?.[anchorAt(snapshot.clock, seconds)];
  return anchor === undefined
    ? snapshot.epochOffset + seconds * 1000
    : anchor.wall + (seconds - anchor.media) * 1000;
};

/**
 * Wall-clock epoch ms as media seconds. A time inside a gap (nothing captured) goes to where
 * capturing started again.
 */
export const mediaAt = (snapshot: PlaybackSnapshot, wall: number): number => {
  const clock = snapshot.clock;
  if (clock === undefined || clock.length === 0) return (wall - snapshot.epochOffset) / 1000;
  let index = 0;
  while (index + 1 < clock.length && (clock[index + 1]?.wall ?? Infinity) <= wall) index += 1;
  const anchor = clock[index];
  const next = clock[index + 1];
  if (anchor === undefined) return (wall - snapshot.epochOffset) / 1000;
  const media = anchor.media + (wall - anchor.wall) / 1000;
  return next === undefined ? media : Math.min(media, next.media);
};

/** The wall-clock gaps between a playlist's stretches, for the timeline. */
export const clockGaps = (snapshot: PlaybackSnapshot): { start: number; end: number }[] => {
  const clock = snapshot.clock ?? [];
  return clock.flatMap((anchor, index) => {
    const before = clock[index - 1];
    if (before === undefined) return [];
    const end = before.wall + (anchor.media - before.media) * 1000;
    return anchor.wall > end ? [{ start: end, end: anchor.wall }] : [];
  });
};

/** Within this many seconds of the live point, the player counts as live. */
export const AT_LIVE_TOLERANCE = 6;

/** The point "Watch live" goes to: hls.js's live point, else the newest second there is. */
export const livePoint = (snapshot: PlaybackSnapshot): number =>
  snapshot.liveSync === null
    ? snapshot.seekableEnd
    : Math.min(snapshot.liveSync, snapshot.seekableEnd);

/** How far behind live playback is, in seconds; never negative. */
export const behindLive = (snapshot: PlaybackSnapshot): number =>
  Math.max(0, livePoint(snapshot) - snapshot.currentTime);

/** A media time held inside what can be played, never past the live point. */
export const clampToPlayable = (snapshot: PlaybackSnapshot, time: number): number =>
  Math.min(livePoint(snapshot), Math.max(snapshot.seekableStart, time));

/**
 * Wall-clock ms of media time 0. The playlist's PROGRAM-DATE-TIME is the truth when it is
 * plausible; a stream whose clock is off by more than two minutes (or has none) is anchored so
 * its newest second is now, which is what live means.
 */
export const wallClockOffset = (input: {
  readonly programDateOffset: number | null;
  readonly seekableEnd: number;
  readonly now: number;
}): number => {
  const anchored = input.now - input.seekableEnd * 1000;
  if (input.programDateOffset === null) return anchored;
  return Math.abs(input.programDateOffset - anchored) <= 120_000
    ? input.programDateOffset
    : anchored;
};
