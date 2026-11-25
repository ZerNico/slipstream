import {
  idleHold,
  pressKey,
  type AccelerationConfig,
  type KeyHold,
} from "../tv/guide/core/index.ts";

/**
 * The TV player's three states (design doc "TV · Player"): controls hidden, the timeline
 * focused for scrubbing, or the controls row focused.
 */
export type ControlsMode = "hidden" | "timeline" | "controls";

/** Everything the controls overlay needs between key presses. Times are epoch ms. */
export interface ControlsState {
  readonly mode: ControlsMode;
  /** The "−32:00 behind live" pill shows until this time after a skip with hidden controls. */
  readonly pillUntil: number | undefined;
  /** The controls hide by themselves at this time unless a key arrives. */
  readonly hideAt: number | undefined;
  /** Seconds the scrub preview sits away from the playhead while the timeline is focused. */
  readonly scrub: number;
  readonly hold: KeyHold;
}

/** The remote keys the player reads, each going down (repeats included) or up. */
export type PlayerKey =
  | "left"
  | "right"
  | "up"
  | "down"
  | "select"
  | "back"
  | "playPause"
  | "fastForward"
  | "rewind";

/** What the player should do after a key. */
export type PlayerCommand =
  | { readonly _tag: "SeekBy"; readonly seconds: number }
  | { readonly _tag: "TogglePause" }
  | { readonly _tag: "Exit" };

/** Skip with hidden controls: 10 s each way. */
export const SKIP_SECONDS = 10;
/** The controls row's skip forward button: 30 s (its skip back is {@link SKIP_SECONDS}). */
export const SKIP_FORWARD_SECONDS = 30;
/** How long the delta pill stays after a skip. */
export const PILL_MS = 3000;
/** Controls hide after this long without a key. */
export const AUTO_HIDE_MS = 5000;

/** Scrub step sizes, slowest first: 10 s, then 30 s, 2 min and 5 min while a key is held. */
export const SCRUB_SECONDS: readonly number[] = [10, 30, 120, 300];

/** Held-key stages for scrubbing; `steps` indexes {@link SCRUB_SECONDS} (1-based). */
export const scrubAcceleration: AccelerationConfig = {
  repeatGap: 600,
  stages: [
    { after: 0, steps: 1 },
    { after: 6, steps: 2 },
    { after: 16, steps: 3 },
    { after: 30, steps: 4 },
  ],
};

/** Controls hidden, nothing pending. */
export const initialControls: ControlsState = {
  mode: "hidden",
  pillUntil: undefined,
  hideAt: undefined,
  scrub: 0,
  hold: idleHold,
};

type Result = { readonly state: ControlsState; readonly command: PlayerCommand | undefined };

const show = (state: ControlsState, mode: ControlsMode, now: number): ControlsState => ({
  ...state,
  mode,
  pillUntil: undefined,
  hideAt: now + AUTO_HIDE_MS,
});

const hide = (state: ControlsState): ControlsState => ({
  ...state,
  mode: "hidden",
  hideAt: undefined,
  scrub: 0,
  hold: idleHold,
});

const keyDown = (state: ControlsState, key: PlayerKey, now: number): Result => {
  if (key === "playPause")
    return {
      state: show(state, state.mode === "hidden" ? "controls" : state.mode, now),
      command: { _tag: "TogglePause" },
    };
  const direction =
    key === "left" || key === "rewind" ? -1 : key === "right" || key === "fastForward" ? 1 : 0;
  switch (state.mode) {
    case "hidden": {
      if (direction !== 0) {
        return {
          state: { ...state, pillUntil: now + PILL_MS },
          command: { _tag: "SeekBy", seconds: direction * SKIP_SECONDS },
        };
      }
      if (key === "back") return { state, command: { _tag: "Exit" } };
      return { state: show(state, "controls", now), command: undefined };
    }
    case "controls": {
      if (key === "back") return { state: hide(state), command: undefined };
      if (key === "up") return { state: show(state, "timeline", now), command: undefined };
      // Left, right and OK move and press native focus inside the row.
      return { state: show(state, "controls", now), command: undefined };
    }
    case "timeline": {
      if (key === "back") return { state: hide(state), command: undefined };
      if (key === "down")
        return { state: { ...show(state, "controls", now), scrub: 0 }, command: undefined };
      if (key === "select") {
        const seconds = state.scrub;
        return {
          state: { ...show(state, "timeline", now), scrub: 0, hold: idleHold },
          command: seconds === 0 ? { _tag: "TogglePause" } : { _tag: "SeekBy", seconds },
        };
      }
      if (direction !== 0) {
        const pressed = pressKey(state.hold, key, now, scrubAcceleration);
        const step = SCRUB_SECONDS[pressed.steps - 1] ?? SCRUB_SECONDS[0] ?? SKIP_SECONDS;
        return {
          state: {
            ...show(state, "timeline", now),
            hold: pressed.hold,
            scrub: state.scrub + direction * step,
          },
          command: undefined,
        };
      }
      return { state: show(state, "timeline", now), command: undefined };
    }
  }
};

/**
 * Applies one remote key. Scrubbing moves a preview while an arrow is held and seeks once when
 * it comes back up (or on OK), so the player is not asked to seek on every key repeat.
 */
export const reduceKey = (
  state: ControlsState,
  key: PlayerKey,
  phase: "down" | "up",
  now: number,
): Result => {
  if (phase === "down") return keyDown(state, key, now);
  const arrow = key === "left" || key === "right" || key === "rewind" || key === "fastForward";
  if (state.mode === "timeline" && arrow && state.scrub !== 0) {
    return {
      state: { ...state, scrub: 0, hold: idleHold },
      command: { _tag: "SeekBy", seconds: state.scrub },
    };
  }
  return { state: { ...state, hold: idleHold }, command: undefined };
};

/**
 * Advances time: hides the controls and the pill when their time is up. `hold` keeps the
 * controls up (a paused phone player, as every phone player does).
 */
export const tickControls = (state: ControlsState, now: number, hold = false): ControlsState => {
  let next = state;
  if (next.pillUntil !== undefined && now >= next.pillUntil)
    next = { ...next, pillUntil: undefined };
  // Never hide in the middle of a scrub; the preview would jump back.
  if (!hold && next.hideAt !== undefined && now >= next.hideAt && next.scrub === 0)
    next = hide(next);
  return next;
};

/** The phone player opens with its controls up; they hide by themselves like the TV's. */
export const shownControls = (now: number): ControlsState => show(initialControls, "controls", now);

/** A tap on the picture (phone): shows the controls, or hides them when they show. */
export const tapPicture = (state: ControlsState, now: number): ControlsState =>
  state.mode === "hidden" ? show(state, "controls", now) : hide(state);

/** Holding the picture for speed clears the controls away, so only the "2×" pill shows. */
export const hideControls = (state: ControlsState): ControlsState =>
  state.mode === "hidden" ? state : hide(state);

/** A touch on the controls keeps them up for another while. */
export const keepControls = (state: ControlsState, now: number): ControlsState =>
  state.mode === "hidden" ? state : show(state, state.mode, now);

/** Which side of the picture a double tap skips: the left and right two fifths. */
export const tapSide = (x: number, width: number): -1 | 1 | undefined =>
  x < 0.4 * width ? -1 : x > 0.6 * width ? 1 : undefined;

/** The "−20 s" a run of double taps shows on its side, adding up while the taps keep coming. */
export interface SkipRun {
  readonly direction: -1 | 1;
  readonly seconds: number;
  /** The run ends, and its hint goes, at this time unless another tap comes. */
  readonly until: number;
}

/** How long a skip run waits for the next tap. */
export const SKIP_RUN_MS = 900;

/** One more skip of {@link SKIP_SECONDS}: the same side within the run adds up, else a new run. */
export const addSkip = (run: SkipRun | undefined, direction: -1 | 1, now: number): SkipRun =>
  run !== undefined && run.direction === direction && now < run.until
    ? { direction, seconds: run.seconds + SKIP_SECONDS, until: now + SKIP_RUN_MS }
    : { direction, seconds: SKIP_SECONDS, until: now + SKIP_RUN_MS };

/** Maps a react-native-tvos event type to a player key. */
export const playerKeyFor = (eventType: string): PlayerKey | undefined => {
  switch (eventType) {
    case "left":
    case "right":
    case "up":
    case "down":
    case "select":
    case "playPause":
    case "fastForward":
    case "rewind":
      return eventType;
    case "back":
    case "menu":
      return "back";
    default:
      return undefined;
  }
};
