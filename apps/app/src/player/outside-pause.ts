/*
 * Play and pause from outside the player's own controls: the media notification, the lock
 * screen, headphones, a Bluetooth car kit, the picture-in-picture window's button. They drive
 * the native player directly; the player hears it as react-native-video's playing state and
 * follows, so its own Pause button is never one press behind.
 *
 * The event says whether the native player means to play (Media3's playWhenReady, patched in
 * `patches/react-native-video@6.19.3.patch`), so waiting for data never reads as a pause; a
 * seek or a renewed playlist loading says nothing either way.
 */

export interface NativePlaying {
  readonly isPlaying: boolean;
  readonly isSeeking: boolean;
}

/**
 * Whether the player should now be paused, from the native player's playing state, or
 * `undefined` when that state says nothing about it (seeking, loading).
 */
export const pausedFromNative = (
  event: NativePlaying,
  context: { readonly loaded: boolean },
): boolean | undefined => {
  if (event.isPlaying) return false;
  if (event.isSeeking || !context.loaded) return undefined;
  return true;
};
