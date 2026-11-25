/**
 * Names for the languages a reader can pick. Each language is named in its own words
 * ("Deutsch", "English"), so a reader finds theirs whatever the current language is.
 */
import type { Locale } from "./locales.ts";
import { m } from "./runtime.ts";

const names: Readonly<Record<Locale, () => string>> = {
  en: () => m.language_en(),
  de: () => m.language_de(),
};

/** A language as a picker names it. */
export const languageName = (locale: Locale): string => names[locale]();
