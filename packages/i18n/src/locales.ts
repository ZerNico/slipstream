/**
 * The languages Slipstream speaks and how a reader's region joins them. English is the
 * source; German is the first translation. The language picks the words, the region picks
 * how dates and numbers are written (14:05 or 2:05 PM, 6,1 or 6.1).
 */

/** Every language with a catalogue, source first. */
export const locales = ["en", "de"] as const;

/** A language with a catalogue. */
export type Locale = (typeof locales)[number];

/** The source language, used when nothing better matches. */
export const baseLocale: Locale = "en";

/** Whether a string names a language with a catalogue. */
export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

const parse = (tag: string): Intl.Locale | undefined => {
  try {
    return new Intl.Locale(tag.replace("_", "-"));
  } catch {
    return undefined;
  }
};

/** The region of a tag like "en-DE" or "de_AT", or undefined when it names none. */
export const regionOf = (tag: string | undefined): string | undefined =>
  tag ? parse(tag)?.region : undefined;

/**
 * One preferred locale already split into language and region: what the app's
 * `expo-localization` hands over (`languageCode`, `regionCode`), since Hermes has no
 * `Intl.Locale` to split a tag with.
 */
export interface LocaleParts {
  readonly language: string | null | undefined;
  readonly region: string | null | undefined;
}

/** The best catalogue for preferred locales in order: the first with a catalogue, else English. */
export const matchLocaleParts = (preferred: readonly LocaleParts[]): Locale =>
  preferred.map((parts) => parts.language?.toLowerCase()).find(isLocale) ?? baseLocale;

/**
 * The region to format with when the reader has not chosen one: the first region named for
 * the chosen language, else the first named at all, so a German device reading English keeps
 * German dates and numbers.
 */
export const detectRegionParts = (
  language: Locale,
  preferred: readonly LocaleParts[],
): string | undefined =>
  preferred.find((parts) => parts.language?.toLowerCase() === language && parts.region)?.region ??
  preferred.find((parts) => parts.region)?.region ??
  undefined;

/** A tag split with `Intl.Locale` (browsers and Node have it). */
const partsOf = (tag: string): LocaleParts => {
  const parsed = parse(tag);
  return { language: parsed?.language, region: parsed?.region };
};

/**
 * The best catalogue for a list of preferred tags (`navigator.languages` on the web): the
 * first whose language has a catalogue, else English.
 */
export const matchLocale = (preferred: readonly string[]): Locale =>
  matchLocaleParts(preferred.map(partsOf));

/** {@link detectRegionParts} for tags (the web). */
export const detectRegion = (language: Locale, preferred: readonly string[]): string | undefined =>
  detectRegionParts(language, preferred.map(partsOf));

/**
 * The BCP 47 tag to hand `Intl` for a language written the way a region writes it, when the
 * platform knows that pair ("en-DE" works, an unknown pair falls back to the language).
 */
export const formatTag = (language: Locale, region: string | undefined): string => {
  if (!region) return language;
  const tag = `${language}-${region}`;
  try {
    return new Intl.DateTimeFormat(tag).resolvedOptions().locale === tag ? tag : language;
  } catch {
    return language;
  }
};
