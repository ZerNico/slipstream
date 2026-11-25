/**
 * Every key the web app keeps in this browser's `localStorage`, under one prefix so they are
 * easy to find and clear. Per-viewer conveniences only (a theme, a language, the last shape of
 * a list): nothing here may be needed for the app to work. Free of imports, because the
 * index.html build step reads the theme key too.
 */
const prefix = "ss-";

export const storageKeys = {
  /** The theme choice; index.html reads it before first paint (SPEC §3.1). */
  theme: `${prefix}theme`,
  /** The language a reader picked. */
  locale: `${prefix}locale`,
  /** Where the desktop mini player sits and how wide it is. */
  miniPlayer: `${prefix}mini-player`,
  /** The last answer of a read, for its skeleton. */
  shape: (name: string) => `${prefix}shape.${name}`,
  /** How many rows a list had last time, for its skeleton. */
  count: (name: string) => `${prefix}count.${name}`,
} as const;
