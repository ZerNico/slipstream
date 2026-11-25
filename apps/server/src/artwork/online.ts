/**
 * Pictures found online for guide titles (TMDB, with the household's own key): which titles are
 * looked up, under which key the answer is cached, and which search result counts. Pure, so the
 * rules are tested without the network.
 *
 * Only films and series: sport and news are live events a poster would misrepresent, so they keep
 * the channel card. A result counts only when its title is the guide's title (or its original
 * title), letter for letter after normalising; anything looser puts the wrong film on a card.
 */
import { artworkStyle, cleanTitle, normaliseText, type PartialDate } from "@slipstream/domain";

/** What TMDB is searched for: a film or a series. */
export type OnlineKind = "movie" | "tv";

/** One lookup: the cache key, what to search and how. */
export interface OnlineQuery {
  /** `movie:the matrix:1999` or `tv:tatort`: one lookup serves every airing of the title. */
  readonly key: string;
  readonly kind: OnlineKind;
  readonly query: string;
  /** The film's year, when the guide gives one. */
  readonly year?: number;
}

/** What the lookup reads from a programme or recording. */
export interface OnlineSubject {
  readonly title: string;
  readonly categories: ReadonlyArray<string>;
  readonly originalAirDate?: PartialDate | null | undefined;
}

const comparable = (text: string): string =>
  normaliseText(text)
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The lookup for a programme, or undefined when it is not one to look up (sport, news). */
export const onlineQuery = (subject: OnlineSubject): OnlineQuery | undefined => {
  const style = artworkStyle(subject.categories, subject.title);
  if (style === "sport" || style === "news") return undefined;
  const query = cleanTitle(subject.title);
  if (comparable(query).length < 2) return undefined;
  const kind: OnlineKind = style === "film" ? "movie" : "tv";
  const year = kind === "movie" ? subject.originalAirDate?.year : undefined;
  return {
    key: `${kind}:${comparable(query)}${year === undefined ? "" : `:${year}`}`,
    kind,
    query,
    ...(year === undefined ? {} : { year }),
  };
};

/** Time zones whose guides are written in German. */
const germanZones = new Set([
  "Europe/Berlin",
  "Europe/Busingen",
  "Europe/Vienna",
  "Europe/Zurich",
  "Europe/Vaduz",
  "Europe/Luxembourg",
]);

/**
 * The language TMDB answers titles in, which must be the guide's for a title to match. The
 * server has no language of its own, so the household's time zone stands in for it: German
 * zones search in German, everything else in English (original titles match either way).
 */
export const searchLanguage = (timeZone: string): string =>
  germanZones.has(timeZone) ? "de-DE" : "en-US";

/** The TMDB API's address. */
export const TMDB_API = "https://api.themoviedb.org/3";

/** Where TMDB serves pictures; w780 is sharp on a card and on the hero without being heavy. */
export const TMDB_IMAGES = "https://image.tmdb.org/t/p/w780";

/**
 * How a request carries the key: a v4 read access token (a JWT, `eyJ…`) as a bearer token, a v3
 * API key as the `api_key` parameter. TMDB hands out both; people paste either.
 */
export const tmdbAuth = (
  key: string,
): { readonly headers: Record<string, string>; readonly params: Record<string, string> } =>
  key.startsWith("eyJ")
    ? { headers: { authorization: `Bearer ${key}` }, params: {} }
    : { headers: {}, params: { api_key: key } };

/** The search address for a lookup, in the household's language for the titles TMDB returns. */
export const tmdbSearchUrl = (query: OnlineQuery, key: string, language: string): string => {
  const url = new URL(`${TMDB_API}/search/${query.kind}`);
  url.searchParams.set("query", query.query);
  url.searchParams.set("language", language);
  url.searchParams.set("include_adult", "false");
  if (query.year !== undefined) url.searchParams.set("year", String(query.year));
  for (const [name, value] of Object.entries(tmdbAuth(key).params)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
};

/** The parts of a TMDB search result the match reads. */
export interface TmdbResult {
  readonly title?: string;
  readonly name?: string;
  readonly original_title?: string;
  readonly original_name?: string;
  readonly backdrop_path?: string | null;
}

/**
 * The picture of the first result whose title is the query's (or whose original title is),
 * as a landscape backdrop; undefined when none matches or the match has no backdrop. Posters are
 * portrait and would crop badly on 16:9 cards, so they never stand in.
 */
export const pickImage = (
  results: ReadonlyArray<TmdbResult>,
  query: OnlineQuery,
): string | undefined => {
  const wanted = comparable(query.query);
  const match = results.find((result) =>
    [result.title, result.name, result.original_title, result.original_name].some(
      (title) => title !== undefined && comparable(title) === wanted,
    ),
  );
  const path = match?.backdrop_path;
  return path === undefined || path === null || path === "" ? undefined : `${TMDB_IMAGES}${path}`;
};
