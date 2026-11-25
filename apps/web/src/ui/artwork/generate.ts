/**
 * Artwork: one resolver for every surface (SPEC §7.4) and the generated fallback's style. Pure
 * functions, so the hierarchy and the per-title variation are tested without a browser.
 */
import { artwork, artworkAccents } from "@slipstream/design-tokens";
import { type ArtworkStyle, titleSeed, withoutRepeatMarkers } from "@slipstream/domain";

/** What the resolver and the generator need to know about a programme or a recording. */
export interface ArtworkSubject {
  readonly title: string;
  /** Guide categories ("Sport", "Spielfilm", "Kinder"). */
  readonly categories?: readonly string[];
  /**
   * The channel for the corner chip and sport accents: its logo when it has one, else its short
   * mark ("ZDF"), the same mark the channel's logo chip shows everywhere else.
   */
  readonly channel?: { readonly mark: string; readonly logoUrl?: string };
  /**
   * The design of generated art as the server resolved it (its `Generated` artwork), so web and
   * app draw the same; without it, picked here from the categories.
   */
  readonly style?: ArtworkStyle;
  /** The guide's image (XMLTV `<icon>`). */
  readonly guideImageUrl?: string;
  /** A picture the server found online for the title (TMDB), when the guide has none. */
  readonly onlineImageUrl?: string;
  /** A frame grabbed from the recording 10 minutes in, once that much is captured. */
  readonly frameUrl?: string;
  /** When the frame was grabbed (epoch ms), for "Frame from the recording · 18:10". */
  readonly frameAt?: number;
  /** A failed recording has no frame to show. */
  readonly failed?: boolean;
}

/** Where a picture comes from: the guide, a frame of the recording, or generated here. */
export type ArtworkSource =
  | { readonly kind: "guide"; readonly url: string }
  | { readonly kind: "online"; readonly url: string }
  | { readonly kind: "frame"; readonly url: string; readonly grabbedAt?: number }
  | { readonly kind: "generated" };

/**
 * The one artwork resolver (SPEC §7.4): the guide image when there is one, else a picture found
 * online for the title (TMDB), else a frame from the recording (never for a failed one), else
 * generated artwork. A programme with a running
 * recording passes that recording's frame, so the same item looks the same on every surface.
 */
export const artworkFor = (subject: ArtworkSubject): ArtworkSource => {
  if (subject.guideImageUrl) return { kind: "guide", url: subject.guideImageUrl };
  if (subject.onlineImageUrl) return { kind: "online", url: subject.onlineImageUrl };
  if (subject.frameUrl && !subject.failed) {
    return subject.frameAt === undefined
      ? { kind: "frame", url: subject.frameUrl }
      : { kind: "frame", url: subject.frameUrl, grabbedAt: subject.frameAt };
  }
  return { kind: "generated" };
};

/** The words generated artwork sets: a kicker, the main line and a sub line. */
export interface ArtworkTitle {
  readonly kicker: string;
  readonly main: string;
  readonly sub: string;
}

/** Drops the guide's repeat markers ("(Wh.)", "Wdh.") from a poster line. */
const clean = (text: string | undefined) => withoutRepeatMarkers(text ?? "");

/**
 * Splits a guide title the way posters set it: "Live F1: Qualifying - GP Katar" becomes kicker
 * "Live · F1", main "Qualifying", sub "GP Katar"; "Tatort: Borowski" becomes "Tatort" over
 * "Borowski". `filmKicker` is the word films get as their kicker (from the messages).
 */
export const artworkTitle = (
  title: string,
  kind: ArtworkStyle,
  filmKicker: string,
): ArtworkTitle => {
  const f1 = /^(Live )?F1( Academy)?:\s*(.+?)(?:\s+-\s+(.+))?$/u.exec(title);
  if (f1) {
    return {
      kicker: `${f1[1] ? "Live · " : ""}F1${f1[2] ?? ""}`,
      main: clean(f1[3]),
      sub: clean(f1[4]),
    };
  }
  if (kind === "film") return { kicker: filmKicker, main: title, sub: "" };
  const series = /^([^:]{3,22}):\s*(.+)$/u.exec(title);
  if (series?.[1] && series[2]) return { kicker: series[1], main: series[2], sub: "" };
  return { kicker: "", main: title, sub: "" };
};

/** Main-line size step: long titles step down so they fit the poster. */
export const mainLineStep = (main: string): 0 | 1 | 2 =>
  main.length > 17 ? 2 : main.length > 11 ? 1 : 0;

const hsl = (h: number, s: number, l: number) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;

/** The CSS custom properties a generated artwork paints with, varied per title. */
export const artworkVars = (
  subject: ArtworkSubject,
  kind: ArtworkStyle,
): Record<string, string> => {
  const base = subject.title.replace(/^Live /u, "").split(" - ")[0] ?? subject.title;
  const h = titleSeed(base);
  const vars: Record<string, string> = {};
  const channelColor = artwork.off;
  switch (kind) {
    case "sport": {
      vars["--a1"] = channelColor;
      vars["--a2"] = `color-mix(in oklab, ${channelColor} 53%, transparent)`;
      // A row of F1 sessions never repeats: the stripe angle and offset follow the title.
      const variant = titleSeed(`${subject.title}·v`);
      const sign = variant % 2 === 1 ? -1 : 1;
      vars["--ang"] = `${sign * (30 + (variant % 47))}deg`;
      vars["--off"] = `${18 + (titleSeed(`${subject.title}x`) % 52)}%`;
      break;
    }
    case "crime": {
      const { a1, a2 } = artworkAccents.crime;
      vars["--a1"] = hsl(a1.hue + (h % a1.spread), a1.s, a1.l);
      vars["--a2"] = hsl(a2.hues[h % 2] ?? a2.hues[0], a2.s, a2.l);
      break;
    }
    case "film": {
      const { a1 } = artworkAccents.film;
      vars["--a1"] = hsl(a1.hue + (h % a1.spread), a1.s, a1.l);
      break;
    }
    case "news": {
      const { a1 } = artworkAccents.news;
      vars["--a1"] = hsl(a1.hue + (h % a1.spread), a1.s, a1.l);
      break;
    }
    case "docs": {
      const { a1, a2 } = artworkAccents.doc;
      vars["--a1"] = hsl((a1.hues[h % 2] ?? a1.hues[0]) + (h % a1.spread), a1.s, a1.l);
      vars["--a2"] = hsl(a2.hue + (h % a2.spread), a2.s, a2.l);
      break;
    }
    case "kids": {
      const { a1, a2 } = artworkAccents.kids;
      vars["--a1"] = hsl(a1.hues[h % a1.hues.length] ?? a1.hues[0], a1.s, a1.l);
      vars["--a2"] = hsl(a2.hues[h % a2.hues.length] ?? a2.hues[0], a2.s, a2.l);
      break;
    }
    case "show": {
      const { a1, a2 } = artworkAccents.show;
      vars["--a1"] = hsl(h, a1.s, a1.l);
      vars["--a2"] = hsl(h + a2.offset, a2.s, a2.l);
      break;
    }
  }
  return vars;
};
