/**
 * The language and region in effect, shared by everything that renders text. Plain module
 * state with a subscription, so React (`useSyncExternalStore`) and React Native can
 * re-render on change without this package depending on either.
 */
import { de, en } from "../messages/index.ts";
import { bindMessages, type Catalogue, type Messages, messageKeys } from "./catalogue.ts";
import { createFormatters, type Formatters } from "./format.ts";
import { baseLocale, formatTag, type Locale } from "./locales.ts";

/** Every catalogue by language. */
export const catalogues: Readonly<Record<Locale, Catalogue>> = { en, de };

interface State {
  readonly locale: Locale;
  readonly region: string | undefined;
  readonly timeZone: string | undefined;
  readonly f: Formatters;
}

const listeners = new Set<() => void>();
let state: State = {
  locale: baseLocale,
  region: undefined,
  timeZone: undefined,
  f: createFormatters(baseLocale),
};

const update = (next: Omit<State, "f">) => {
  if (
    next.locale === state.locale &&
    next.region === state.region &&
    next.timeZone === state.timeZone
  ) {
    return;
  }
  const { locale, region, timeZone } = next;
  state = { locale, region, timeZone, f: createFormatters(locale, { region, timeZone }) };
  for (const listener of listeners) listener();
};

/** The language in effect. */
export const getLocale = (): Locale => state.locale;

/** Switches the language; listeners run when it changes. */
export const setLocale = (locale: Locale): void => update({ ...state, locale });

/** The region in effect, or undefined for the language's default. */
export const getRegion = (): string | undefined => state.region;

/** Sets the region dates and numbers follow ("DE", "GB"), or undefined for the default. */
export const setRegion = (region: string | undefined): void => update({ ...state, region });

/** The time zone clock times and days are written in, or undefined for the device's zone. */
export const getTimeZone = (): string | undefined => state.timeZone;

/**
 * Sets the IANA time zone every clock time and day is written in ("Europe/Berlin"): the
 * household's, so a reader abroad sees the times the server records by. Undefined returns to
 * the device's zone.
 */
export const setTimeZone = (timeZone: string | undefined): void => update({ ...state, timeZone });

/**
 * The tag to hand `Intl` and `toLocale*` for anything a person reads: the language written
 * the way the region writes it. Never the bare language, which formats every English reader
 * as American.
 */
export const formatLocale = (): string => formatTag(state.locale, state.region);

/** Formatters for the language, region and time zone in effect. */
export const formatters = (): Formatters => state.f;

/** Runs `listener` when the language, region or time zone changes; returns the unsubscribe. */
export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Messages in the language in effect at each call: `m.nav_home()`. */
export const m: Messages = bindMessages(messageKeys, () => ({
  catalogue: catalogues[state.locale],
  f: state.f,
}));

/**
 * Messages fixed to one language and region, for text that must not follow the reader's
 * setting (server-side notices, tests).
 */
export const messagesFor = (
  locale: Locale,
  options: { readonly region?: string; readonly timeZone?: string } = {},
): Messages => {
  const resolved = { catalogue: catalogues[locale], f: createFormatters(locale, options) };
  return bindMessages(messageKeys, () => resolved);
};
