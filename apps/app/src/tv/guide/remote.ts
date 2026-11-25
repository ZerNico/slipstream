import { idleHold, pressKey, type GuideAction, type KeyHold } from "./core/index.ts";

/**
 * The fields of react-native-tvos's `TVRemoteEvent` the guide reads. Android sends
 * `eventKeyAction` as a number (0 down, 1 up) although the type says string, and repeats the
 * down event while a key is held.
 */
export interface RemoteEventLike {
  readonly eventType: string;
  readonly eventKeyAction?: string | number | undefined;
}

/**
 * A key going down or coming back up. `held` marks an arrow held past react-native-tvos's long
 * press (300 ms on Android): it then sends that key going down once, as `longRight` and so on,
 * and nothing more until it comes up, so whoever wants a held arrow to keep moving repeats it.
 */
export interface RemotePress {
  readonly key: string;
  readonly phase: "down" | "up";
  readonly held?: true;
}

/** The arrows' long-press names, read as the arrow itself. */
const LONG_ARROWS: Readonly<Record<string, string>> = {
  longUp: "up",
  longDown: "down",
  longLeft: "left",
  longRight: "right",
};

/** How often a held arrow repeats, ms: about Android's own key repeat rate. */
export const HELD_REPEAT_MS = 80;

/** Reads a remote event; events without a key action (iOS, focus events) count as down. */
export const readPress = (event: RemoteEventLike): RemotePress | undefined => {
  if (event.eventType === "focus" || event.eventType === "blur") return undefined;
  const action = event.eventKeyAction === undefined ? 0 : Number(event.eventKeyAction);
  const phase = action === 1 ? "up" : "down";
  const arrow = LONG_ARROWS[event.eventType];
  return arrow === undefined ? { key: event.eventType, phase } : { key: arrow, phase, held: true };
};

/**
 * The guide action for a remote key, `steps` far for arrows. CH +/- page, rewind and
 * fast-forward (or previous/next) change the day, and Info jumps back to now.
 */
export const guideActionForKey = (
  key: string,
  steps: number,
  now: number,
): GuideAction | undefined => {
  switch (key) {
    case "up":
      return { _tag: "Up", steps };
    case "down":
      return { _tag: "Down", steps };
    case "left":
      return { _tag: "Left", steps };
    case "right":
      return { _tag: "Right", steps };
    case "channelUp":
      return { _tag: "PageUp" };
    case "channelDown":
      return { _tag: "PageDown" };
    case "rewind":
    case "previous":
      return { _tag: "DayBack" };
    case "fastForward":
    case "next":
      return { _tag: "DayForward" };
    case "info":
      return { _tag: "Now", now };
    default:
      return undefined;
  }
};

/** Keys whose repeats accelerate; paging and day jumps always move one step. */
const ACCELERATED = new Set(["up", "down", "left", "right"]);

/**
 * Feeds one remote event through held-key acceleration. Returns the new hold state and the
 * guide action to apply, if the event maps to one.
 */
export const remoteToAction = (
  hold: KeyHold,
  event: RemoteEventLike,
  at: number,
): { readonly hold: KeyHold; readonly action: GuideAction | undefined } => {
  const press = readPress(event);
  if (press === undefined) return { hold, action: undefined };
  if (press.phase === "up") return { hold: idleHold, action: undefined };
  if (!ACCELERATED.has(press.key)) {
    return { hold: idleHold, action: guideActionForKey(press.key, 1, at) };
  }
  const next = pressKey(hold, press.key, at);
  return { hold: next.hold, action: guideActionForKey(press.key, next.steps, at) };
};
