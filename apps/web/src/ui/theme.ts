import { useSyncExternalStore } from "react";
import { semantic } from "@slipstream/design-tokens";
import { storageKeys } from "~/storage-keys.ts";

/** The reader's choice: follow the device, or always dark or light. */
export type ThemePreference = "system" | "dark" | "light";

/** The storage key; index.html reads the same key before first paint (SPEC §3.1). */
const themeStorageKey = storageKeys.theme;

const listeners = new Set<() => void>();

const read = (): ThemePreference => {
  try {
    const stored = localStorage.getItem(themeStorageKey);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
};

/**
 * Puts the preference on `<html data-theme>`, where the tokens read it, and makes the installed
 * app's status bar follow a manual choice (the per-scheme metas apply only for System, §8.9).
 */
const apply = (preference: ThemePreference) => {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.dataset.scheme === "light" ? "light" : "dark";
    if (preference === "system") {
      meta.media = `(prefers-color-scheme: ${scheme})`;
      meta.content = semantic[scheme].bg.canvas;
    } else {
      meta.removeAttribute("media");
      meta.content = semantic[preference].bg.canvas;
    }
  }
};

/** Stores and applies a theme choice; the page follows it at once and on the next visit. */
export const setThemePreference = (preference: ThemePreference): void => {
  try {
    if (preference === "system") localStorage.removeItem(themeStorageKey);
    else localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
  apply(preference);
  for (const notify of listeners) notify();
};

/** Applies the stored choice to the theme-color metas once at start (index.html did the rest). */
export const initTheme = (): void => apply(read());

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

/** The theme choice in effect, updating when it changes. */
export const useThemePreference = (): ThemePreference =>
  useSyncExternalStore(subscribe, read, () => "system");
