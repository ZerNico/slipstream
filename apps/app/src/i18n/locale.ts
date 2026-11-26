import {
  detectRegionParts,
  isLocale,
  type Locale,
  matchLocaleParts,
  setLocale,
  setRegion,
  setTwentyFourHour,
} from "@slipstream/i18n";
import { getCalendars, getLocales, useCalendars, useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { persistedStore, useStore } from "../data/store.ts";

/** The language a person picked in Settings, or "system" to follow the device. */
export type LanguageChoice = Locale | "system";

/** The device's locales, split already: Hermes has no Intl.Locale to split a tag with. */
const devicePreferred = () =>
  getLocales().map((locale) => ({ language: locale.languageCode, region: locale.regionCode }));

/** The language picked on this device; "system" (nothing stored) follows the device. */
const choice = persistedStore<LanguageChoice>({
  key: "slipstream.language",
  initial: "system",
  parse: (raw) => (isLocale(raw) ? raw : "system"),
  serialise: (value) => (value === "system" ? undefined : value),
});

/**
 * Applies the language: the one picked in Settings, else the device's per-app language (Android
 * 13's App languages), else its system languages; English when none has a catalogue. The region
 * follows the device, so a German phone reading English keeps German dates and numbers.
 */
const apply = (): void => {
  const preferred = devicePreferred();
  const picked = choice.get();
  const language = picked === "system" ? matchLocaleParts(preferred) : picked;
  setLocale(language);
  setRegion(detectRegionParts(language, preferred));
  // Android's own "Use 24-hour format" wins over what the language and region would pick.
  setTwentyFourHour(getCalendars()[0]?.uses24hourClock ?? undefined);
};

/** Picks the language before the first render. */
export const applyDeviceLocale = (): void => {
  let raw: string | null = null;
  try {
    raw = SecureStore.getItem(choice.key);
  } catch {
    // Unreadable: the device's language applies.
  }
  choice.attach(SecureStore, raw);
  apply();
};

/**
 * Follows the device when its language changes while the app runs (system settings, or the
 * app's own entry in Android's App languages). Used once, in the root layout.
 */
export const useFollowDeviceLanguage = (): void => {
  const locales = useLocales();
  const tags = locales.map((locale) => locale.languageTag).join(",");
  const clock = String(useCalendars()[0]?.uses24hourClock);
  // Re-applied when the device's list or its clock setting changes; the first run repeats the
  // start's choice.
  useEffect(apply, [tags, clock]);
};

/** Switches the language now and for every later start; "system" follows the device again. */
export const chooseLanguage = (next: LanguageChoice): void => {
  choice.set(next);
  apply();
};

/** The language picked in Settings ("system" to follow the device). */
export const useLanguageChoice = (): LanguageChoice => useStore(choice);
