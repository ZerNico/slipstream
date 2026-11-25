/*
 * What a guide category says about a programme, read once for episode identity, grouping and
 * generated artwork: whether it is sport, and whether it is a film. Categories come from the
 * guide in English or German and in any case.
 */

/** Categories treated as films when the household's settings do not say otherwise. */
export const defaultFilmCategories: ReadonlyArray<string> = [
  "film",
  "spielfilm",
  "movie",
  "kinofilm",
  "kino",
];

/** Words that make a category sport, anywhere in it ("Motorsport", "Sport > Fußball"). */
const sportWords = /sport|fußball|fussball|football|soccer|formel 1|tennis|darts|snooker/iu;

/** Whether one guide category is sport. */
export const isSportCategory = (category: string): boolean => sportWords.test(category);

/**
 * Whether one guide category marks a film: one of `filmCategories` (the household's list, else
 * `defaultFilmCategories`), compared without case or outer spaces.
 */
export const isFilmCategory = (
  category: string,
  filmCategories: ReadonlyArray<string> = defaultFilmCategories,
): boolean => {
  const word = category.trim().toLowerCase();
  return filmCategories.some((film) => film.trim().toLowerCase() === word);
};
