import { useSyncExternalStore } from "react";
import {
  detectRegion,
  getLocale,
  isLocale,
  matchLocale,
  setLocale,
  setRegion,
  subscribe,
  type Locale,
} from "@slipstream/i18n";
import { storageKeys } from "~/storage-keys.ts";

const KEY = storageKeys.locale;

const stored = (): Locale | undefined => {
  try {
    const value = localStorage.getItem(KEY);
    return isLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const preferred = (): readonly string[] =>
  typeof navigator === "undefined" ? [] : navigator.languages;

const apply = (locale: Locale) => {
  setLocale(locale);
  setRegion(detectRegion(locale, preferred()));
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};

/**
 * Picks the language before the first render: the reader's earlier choice, else the best
 * match for the browser's languages. The region follows the browser, so an English reader in
 * Germany keeps 24-hour times and decimal commas.
 */
export const initLocale = (): void => apply(stored() ?? matchLocale(preferred()));

/** The language a reader picked, or "system" to follow the browser. */
export type LanguageChoice = Locale | "system";

/** Switches the language now and for the next visit; "system" follows the browser again. */
export const chooseLocale = (choice: LanguageChoice): void => {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
  apply(choice === "system" ? matchLocale(preferred()) : choice);
};

/** What the reader picked: a language, or "system" while the browser decides. */
export const useLanguageChoice = (): LanguageChoice => {
  useLocale();
  return stored() ?? "system";
};

/** The language in effect; components using it re-render when it changes. */
export const useLocale = (): Locale => useSyncExternalStore(subscribe, getLocale, getLocale);
