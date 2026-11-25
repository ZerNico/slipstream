/**
 * The shape of one area of the catalogue (`home.ts`, `guide.ts`, ...). Each area keeps its
 * English, German and samples side by side, so a screen adds a message in one file and parallel
 * work on other screens never touches it.
 */
import type { Formatters } from "../src/format.ts";
import type { Translation } from "../src/translation.ts";
import type { Weekday } from "./weekday.ts";

/** A message as written in a source catalogue: text, or text built from parameters. */
type SourceMessage = string | ((params: never, f: Formatters) => string);

/** The keys of `E` whose messages take parameters. */
type ParamKeys<E> = {
  [K in keyof E]: E[K] extends (params: infer _P, f: Formatters) => string ? K : never;
}[keyof E];

/** One realistic set of parameters for every message in `E` that takes them. */
export type Samples<E> = {
  readonly [K in ParamKeys<E>]: E[K] extends (params: infer P, f: Formatters) => string ? P : never;
};

/** One area: English source, German translation, parameter samples and deliberate twins. */
export interface Area<E> {
  readonly en: E;
  readonly de: Translation<E>;
  /** Rendered by the catalogue test in both languages, so a missing value or a stray `#` fails. */
  readonly samples: Samples<E>;
  /** Keys whose German text is the same as the English on purpose (names, units, loan words). */
  readonly sameInGerman: readonly (keyof E & string)[];
}

/**
 * Declares an area. The English object fixes the keys and parameter types; German, samples and
 * `sameInGerman` are checked against it, so a missing translation or sample is a type error.
 */
export const defineArea = <E extends Record<string, SourceMessage>>(area: Area<E>): Area<E> => area;

/** The moments the samples use: Sunday 22 November 2026, 05:00 to 07:00 in Berlin. */
export const sampleStart = new Date("2026-11-22T04:00:00Z");

/** The end of the sample window. */
export const sampleEnd = new Date("2026-11-22T06:00:00Z");

/** Weekdays as the series recording editor's pills write them. */
export const weekdayShortEn: Readonly<Record<Weekday, string>> = {
  mon: "Mo",
  tue: "Tu",
  wed: "We",
  thu: "Th",
  fri: "Fr",
  sat: "Sa",
  sun: "Su",
};

/** Weekdays in full, for sentences. */
export const weekdayLongEn: Readonly<Record<Weekday, string>> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** German weekday pills. */
export const weekdayShortDe: Readonly<Record<Weekday, string>> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

/** German weekdays in full. */
export const weekdayLongDe: Readonly<Record<Weekday, string>> = {
  mon: "Montag",
  tue: "Dienstag",
  wed: "Mittwoch",
  thu: "Donnerstag",
  fri: "Freitag",
  sat: "Samstag",
  sun: "Sonntag",
};
