import type { ArtworkSubject } from "~/ui/artwork/generate.ts";

/*
 * The auth wall shows generated artwork without words: each subject only picks a genre style
 * (from its category) and a variation (from its seed), so no title is ever drawn.
 */
const styles = ["Sport", "Krimi", "Spielfilm", "Nachrichten", "Dokumentation", "Kinder", "Show"];

const subject = (index: number): ArtworkSubject => ({
  title: `wall-${index}`,
  categories: [styles[index % styles.length] ?? "Show"],
});

/** Three columns of four artworks, each column a different mix of styles. */
export const wallColumns: readonly (readonly ArtworkSubject[])[] = [0, 1, 2].map((column) =>
  [0, 1, 2, 3].map((row) => subject(column * 5 + row * 3)),
);
