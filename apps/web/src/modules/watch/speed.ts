/*
 * The web player's side of playback speed (SPEC §7.1). The speeds, stepping and when a faster
 * speed reaches live are the domain's (`playbackSpeeds`, `stepSpeed`, `liveEta`).
 */

/**
 * When a finished recording ends at `speed`, epoch ms: what is left divided by the speed.
 */
export const endsAt = (input: {
  readonly now: number;
  readonly leftMs: number;
  readonly speed: number;
}): number => input.now + Math.max(0, input.leftMs) / Math.max(0.25, input.speed);

/**
 * Surround sound plays as stereo while the speed isn't 1× (SPEC §7.1): the server converts
 * it once the session reports the new rate. True when this track needs that.
 */
export const surroundAsStereo = (speed: number, channels: number | undefined): boolean =>
  speed !== 1 && channels !== undefined && channels > 2;
