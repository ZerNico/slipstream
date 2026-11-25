/*
 * The player's keyboard (SPEC §7.2): Space or K play and pause, J/L or ←/→ skip 10 s (Shift
 * 60 s), Home goes to the start of the programme, End to live, ↑/↓ change the volume, M mutes,
 * < and > change the speed, A and Q open the audio and Options menus, I the panel, Z Fill/Fit, F full
 * screen, Esc closes the innermost layer.
 */

/** The player's two menus: audio and subtitles (A), Options (Q). */
export type PlayerMenuName = "audio" | "quality";

/** What a key press asks the player to do. */
export type PlayerKeyAction =
  | { readonly kind: "toggle" }
  | { readonly kind: "seek"; readonly seconds: number }
  | { readonly kind: "start" }
  | { readonly kind: "live" }
  | { readonly kind: "volume"; readonly delta: number }
  | { readonly kind: "mute" }
  | { readonly kind: "speed"; readonly direction: 1 | -1 }
  | { readonly kind: "menu"; readonly menu: PlayerMenuName }
  | { readonly kind: "panel" }
  | { readonly kind: "fit" }
  | { readonly kind: "fullscreen" }
  | { readonly kind: "close" };

/** The parts of a key event the mapping reads. */
export type KeyPress = Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">;

/** One step of the volume keys, percent. */
export const volumeStep = 5;

/**
 * Maps a key press to a player action, or undefined when the player does not use the key (so
 * the global shortcuts, `?` and `G` then a letter, keep working). Keys with ⌘, Ctrl or Alt are
 * the browser's and the palette's.
 */
export const playerKeyFor = (event: KeyPress): PlayerKeyAction | undefined => {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const long = event.shiftKey ? 60 : 10;
  switch (event.key) {
    case " ":
    case "k":
    case "K":
      return { kind: "toggle" };
    case "ArrowLeft":
      return { kind: "seek", seconds: -long };
    case "ArrowRight":
      return { kind: "seek", seconds: long };
    case "j":
    case "J":
      return { kind: "seek", seconds: -10 };
    case "l":
    case "L":
      return { kind: "seek", seconds: 10 };
    case "PageDown":
      return { kind: "seek", seconds: -60 };
    case "PageUp":
      return { kind: "seek", seconds: 60 };
    case "Home":
      return { kind: "start" };
    case "End":
      return { kind: "live" };
    case "ArrowUp":
      return { kind: "volume", delta: volumeStep };
    case "ArrowDown":
      return { kind: "volume", delta: -volumeStep };
    case "m":
    case "M":
      return { kind: "mute" };
    case "<":
    case ",":
      return { kind: "speed", direction: -1 };
    case ">":
    case ".":
      return { kind: "speed", direction: 1 };
    case "a":
    case "A":
      return { kind: "menu", menu: "audio" };
    case "q":
    case "Q":
      return { kind: "menu", menu: "quality" };
    case "i":
    case "I":
      return { kind: "panel" };
    case "z":
    case "Z":
      return { kind: "fit" };
    case "f":
    case "F":
      return { kind: "fullscreen" };
    case "Escape":
      return { kind: "close" };
    default:
      return undefined;
  }
};

/**
 * Whether a focused control should keep a key for itself: a range input (volume) takes arrows,
 * Home/End and the page keys; every other shortcut passes through to the player (SPEC §7.2).
 * Buttons keep Space and Enter, so a focused button is pressed rather than the video paused.
 */
export const controlKeepsKey = (target: EventTarget | null, key: string): boolean => {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement && target.type === "range") {
    return (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key) ||
      key === "PageUp" ||
      key === "PageDown"
    );
  }
  if (target.getAttribute("role") === "slider") {
    return [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].includes(key);
  }
  const pressable =
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement ||
    target.getAttribute("role") === "tab" ||
    target.getAttribute("role")?.startsWith("menuitem") === true;
  return pressable && (key === " " || key === "Enter");
};
