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
}

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
