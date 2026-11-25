import { m } from "./runtime.ts";

/**
 * Words for the structured parts of group paths ("Other", "Films", "Season 2", an airing's day
 * and time), the shape of the domain's `PathLabels`. Written structurally so this package needs
 * no domain import: an airing's start is any instant with epoch milliseconds, which every
 * `DateTime.Utc` is.
 */
export interface PathWords {
  readonly other: string;
  readonly films: string;
  readonly season: (season: number) => string;
  readonly episode: (episode: number, subtitle: string | undefined) => string;
  readonly month: (year: number, month: number) => string;
  readonly airing: (start: { readonly epochMilliseconds: number }) => string;
  readonly film: (title: string, year: number | undefined) => string;
}

/** The path words in the language in effect when called, for the web and the app alike. */
export const pathLabels = (): PathWords => ({
  other: m.path_other(),
  films: m.path_films(),
  season: (season) => m.path_season({ season }),
  episode: (episode, subtitle) =>
    m.path_episode(subtitle === undefined ? { episode } : { episode, subtitle }),
  month: (year, month) => m.path_month({ year, month }),
  airing: (start) => m.path_airing({ start: new Date(start.epochMilliseconds) }),
  film: (title, year) => m.path_film(year === undefined ? { title } : { title, year }),
});
