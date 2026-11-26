/*
 * Picture-in-picture on a phone: leaving the app while it plays keeps playing in a small window.
 *
 * react-native-video pauses in `onHostPause` unless the activity already says it is in
 * picture-in-picture, and with Android 12's automatic entry (the home gesture) it does not yet
 * say so there: the window opened paused. So the player lets the video play on in the
 * background while picture-in-picture is armed, and pauses it itself when the window closes.
 *
 * In the background React Native's timers wait until the app comes back, so the pause cannot
 * wait to see whether the app returns: it happens as the window goes, and when the app is in
 * the foreground again right after (the window was expanded, not closed), playback resumes.
 */

/** How soon after the window goes the app has to be back for it to count as expanded, ms. */
export const PIP_EXPAND_MS = 2000;

/** Whether leaving the app opens the small window: a phone, while it plays. */
export const pipArmed = (isTV: boolean, paused: boolean): boolean => !isTV && !paused;

/** Whether the window going away pauses: it does unless the app is already in the foreground. */
export const pauseOnPipExit = (appState: string | null | undefined): boolean =>
  appState !== "active";

/** Whether the app coming back resumes a pause the window's exit made (it was expanded). */
export const resumeAfterPipExit = (pausedAt: number | undefined, now: number): boolean =>
  pausedAt !== undefined && now - pausedAt <= PIP_EXPAND_MS;
