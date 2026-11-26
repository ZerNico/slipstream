/*
 * Picture-in-picture on a phone: leaving the app while it plays keeps playing in a small window.
 *
 * react-native-video pauses in `onHostPause` unless the activity already says it is in
 * picture-in-picture, and with Android 12's automatic entry (the home gesture) it does not yet
 * say so there: the window opened paused. So the player lets the video play on in the
 * background while picture-in-picture is armed, and pauses it itself when the app ended up in
 * the background without the window (picture-in-picture turned off for the app, the screen
 * locked, the window closed).
 */

/** How long after the app leaves the foreground the window has to open before playback pauses. */
export const PIP_SETTLE_MS = 1000;

/** Whether leaving the app opens the small window: a phone, while it plays. */
export const pipArmed = (isTV: boolean, paused: boolean): boolean => !isTV && !paused;

/** Whether to pause: the app is in the background and no window shows the picture. */
export const pauseAway = (appState: string | null | undefined, inPip: boolean): boolean =>
  appState === "background" && !inPip;
