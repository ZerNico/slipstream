/**
 * Seek math for the player spike. react-native-video (Media3) reports positions relative to
 * the start of the seekable window: for a live HLS playlist with a DVR window, 0 is the oldest
 * segment still listed and `seekableDuration` is the live edge.
 */

/** The progress fields react-native-video reports, in seconds. */
export interface PlayerProgress {
  readonly currentTime: number;
  readonly seekableDuration: number;
}

/**
 * How far behind the edge "live" lands, in seconds. Media3 starts live playback about three
 * target durations back; seeking right to the edge stalls while the next segment arrives.
 */
export const LIVE_EDGE_OFFSET = 3 * 6;

/** Distance from the edge still shown as "at live", in seconds. */
export const LIVE_TOLERANCE = LIVE_EDGE_OFFSET + 6;

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/** Where "from start" seeks: the oldest available position. */
export const startTarget = (): number => 0;

/** Where "live" seeks: just behind the live edge, never before the window start. */
export const liveTarget = (progress: PlayerProgress): number =>
  Math.max(0, finiteOr(progress.seekableDuration, 0) - LIVE_EDGE_OFFSET);

/** A relative seek (`delta` seconds) clamped to the seekable window. */
export const relativeTarget = (progress: PlayerProgress, delta: number): number => {
  const end = finiteOr(progress.seekableDuration, 0);
  return Math.min(Math.max(0, finiteOr(progress.currentTime, 0) + delta), end);
};

/** Seconds behind the live edge (0 when unknown). */
export const behindLive = (progress: PlayerProgress): number =>
  Math.max(0, finiteOr(progress.seekableDuration, 0) - finiteOr(progress.currentTime, 0));

/** Whether playback is close enough to the edge to call it live. */
export const isAtLive = (progress: PlayerProgress): boolean =>
  behindLive(progress) <= LIVE_TOLERANCE;
