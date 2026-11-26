/*
 * Play and pause from outside the player's own controls: the media notification, the lock
 * screen, headphones, a Bluetooth car kit, the picture-in-picture window's button. They drive
 * the native player directly; the player hears it as react-native-video's playing state and
 * follows, so its own Pause button is never one press behind.
 *
 * The native player also says "not playing" while it waits for data, seeks, or loads a renewed
 * playlist. None of those is a pause, so they never change the player's state.
 */

export interface NativePlaying {
  readonly isPlaying: boolean;
  readonly isSeeking: boolean;
}

/**
 * Whether the player should now be paused, from the native player's playing state, or
 * `undefined` when that state says nothing about it (buffering, seeking, loading).
 */
export const pausedFromNative = (
  event: NativePlaying,
  context: { readonly buffering: boolean; readonly loaded: boolean },
): boolean | undefined => {
  if (event.isPlaying) return false;
  if (event.isSeeking || context.buffering || !context.loaded) return undefined;
  return true;
};
