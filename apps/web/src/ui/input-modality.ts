/**
 * How the person last interacted: keyboard, or pointer (mouse, touch, pen). Overlays choose
 * their initial focus from it (SPEC §7.3): keyboard opens land on the first control, pointer and
 * deep-link opens on the overlay itself. Base UI knows the modality for its own triggers; this
 * covers overlays opened from anywhere else (a URL change, a menu item, a shortcut).
 */
type Modality = "keyboard" | "pointer" | "none";

let last: Modality = "none";
let listening = false;

const listen = () => {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener(
    "keydown",
    (event) => {
      // Modifier presses alone do not count; Tab, Enter, arrows and letters do.
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) last = "keyboard";
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      last = "pointer";
    },
    true,
  );
};

listen();

/** Whether the last interaction was the keyboard. */
export const lastInputWasKeyboard = (): boolean => last === "keyboard";

/**
 * Whether an overlay opened from the keyboard: Base UI's own interaction type when it knows it,
 * else the last interaction on the page.
 */
export const openedFromKeyboard = (interaction: string): boolean =>
  interaction === "keyboard" || (interaction === "" && lastInputWasKeyboard());
