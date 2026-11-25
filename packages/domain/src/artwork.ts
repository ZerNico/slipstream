import { DateTime, Schema } from "effect";
import { isFilmCategory, isSportCategory } from "./category.ts";
import { ChannelId, RecordingId } from "./ids.ts";
import { isPlayable, type RecordingState } from "./recording.ts";
import { HttpUrl } from "./source.ts";
import { normaliseText } from "./title.ts";
import { epochMs, Instant, MINUTE, type TimeRange } from "./time.ts";

/** Where a picture comes from (SPEC 7.4); shown as the artwork's source badge. */
export const ArtworkSource = Schema.Literals(["guide", "online", "frame", "generated"]);
export type ArtworkSource = typeof ArtworkSource.Type;

/** The design of generated artwork, picked from the guide categories. */
export const ArtworkStyle = Schema.Literals([
  "sport",
  "crime",
  "film",
  "news",
  "docs",
  "kids",
  "show",
]);
export type ArtworkStyle = typeof ArtworkStyle.Type;

/**
 * The picture every surface shows for a programme or recording, from one resolver
 * ({@link resolveArtwork}). `Online` is a picture found online (TMDB) for the title. `Frame`
 * points at the frame endpoint; `Generated` carries what web and
 * app need to draw the same artwork: the style, a seed from the title (stripe angle and offset)
 * and the channel for its mark.
 */
export const Artwork = Schema.TaggedUnion({
  Guide: { url: HttpUrl },
  Online: { url: HttpUrl },
  Frame: {
    recordingId: RecordingId,
    /** The moment the frame shows, "Frame from the recording · 18:10". */
    grabbedAt: Instant,
  },
  Generated: {
    style: ArtworkStyle,
    seed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    channelId: ChannelId,
  },
}).annotate({ identifier: "Artwork" });
export type Artwork = typeof Artwork.Type;

/**
 * A kind of picture the household can put first. `guide` is a picture of the programme: the
 * guide's own image, else one found online (TMDB) for its title. `frame` is a frame grabbed
 * from the recording.
 */
export const ArtworkStep = Schema.Literals(["guide", "frame"]).annotate({
  description: "guide: the guide's image, else one found online for the title; frame: a frame",
});
export type ArtworkStep = typeof ArtworkStep.Type;

/** The pictures the household prefers, in order; generated artwork always comes last. */
export const ArtworkOrder = Schema.Array(ArtworkStep).annotate({ identifier: "ArtworkOrder" });
export type ArtworkOrder = typeof ArtworkOrder.Type;

/** SPEC 7.4: the guide's image, then a frame from the recording, then generated artwork. */
export const defaultArtworkOrder: ArtworkOrder = ["guide", "frame"];

/** How far into the programme a frame is grabbed: after the opening titles. */
export const frameOffsetMinutes = 10;

/**
 * The moment a recording's frame shows: 10 minutes after the programme start (not the padded
 * start), or the middle of programmes shorter than 20 minutes.
 */
export const frameMoment = (programme: TimeRange): Instant => {
  const start = epochMs(programme.start);
  const offset = Math.min(frameOffsetMinutes * MINUTE, (epochMs(programme.end) - start) / 2);
  return DateTime.makeUnsafe(start + Math.max(0, Math.floor(offset)));
};

/**
 * Whether the server should grab a recording's frame now: it holds segments (running recordings
 * included, so Qualifying shows its 18:10 frame while it still records) and has captured past
 * {@link frameMoment}. Failed, cancelled and scheduled recordings have none.
 */
export const frameDue = (
  recording: TimeRange & { readonly state: RecordingState },
  capturedUntil: Instant | undefined,
): boolean =>
  isPlayable(recording) &&
  capturedUntil !== undefined &&
  epochMs(capturedUntil) > epochMs(frameMoment(recording));

/** Guide category words (English and German) that pick a generated style. */
const keywords =
  (...words: ReadonlyArray<string>) =>
  (category: string) =>
    words.includes(normaliseText(category).toLowerCase());

/**
 * How a guide category picks a generated style, strongest first. Sport and film read the
 * categories as episode identity and grouping do (`isSportCategory`, `isFilmCategory`).
 */
const styleTests: ReadonlyArray<readonly [ArtworkStyle, (category: string) => boolean]> = [
  ["kids", keywords("kinder", "kids", "children", "zeichentrick", "animation")],
  ["sport", isSportCategory],
  ["news", keywords("nachrichten", "news")],
  ["crime", keywords("krimi", "crime", "thriller", "mystery")],
  [
    "docs",
    keywords("dokumentation", "doku", "documentary", "reportage", "natur", "wissen", "science"),
  ],
  ["film", (category) => isFilmCategory(category)],
];

/** Titles whose show says its style when the guide gives no category: "Live F1: …", "Tatort". */
const titleStyles: ReadonlyArray<readonly [ArtworkStyle, RegExp]> = [
  ["sport", /\b(?:F1|Formel 1|Bundesliga)\b/iu],
  ["news", /\b(?:Tagesschau|Nachrichten|News)\b/iu],
  ["crime", /\b(?:Tatort|Polizeiruf)\b/iu],
];

/**
 * The generated style for a programme: by its guide categories, else by a show its title names
 * (`titleStyles`), else `show`. The web guide's category filter reads the same, so a sport cell
 * and its sport artwork agree.
 */
export const artworkStyle = (categories: ReadonlyArray<string>, title = ""): ArtworkStyle =>
  styleTests.find(([, test]) => categories.some(test))?.[0] ??
  titleStyles.find(([, words]) => words.test(title))?.[0] ??
  "show";

/**
 * A stable 32-bit seed from a title (FNV-1a over the normalised, lower-cased title), so a row of
 * F1 sessions gets different stripes while one title always looks the same.
 */
export const titleSeed = (title: string): number => {
  let hash = 0x811c9dc5;
  for (const char of normaliseText(title).toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** What the resolver reads: the guide snapshot plus the frame of the recording, if grabbed. */
export interface ArtworkSubject {
  readonly channelId: ChannelId;
  readonly title: string;
  readonly categories: ReadonlyArray<string>;
  readonly imageUrl?: string | undefined;
  /** A picture found online for the title (TMDB), when the server found one. */
  readonly onlineImageUrl?: string | undefined;
  /**
   * The grabbed frame: the recording's own, or for a programme the frame of the recording that
   * captures it. Absent until the server grabbed one.
   */
  readonly frame?: { readonly recordingId: RecordingId; readonly grabbedAt: Instant } | undefined;
}

/** The picture one step of the order finds for a subject, if any (see `ArtworkStep`). */
const pictureFor = (step: ArtworkStep, subject: ArtworkSubject): Artwork | undefined => {
  switch (step) {
    case "guide":
      if (subject.imageUrl !== undefined) return { _tag: "Guide", url: subject.imageUrl };
      return subject.onlineImageUrl === undefined
        ? undefined
        : { _tag: "Online", url: subject.onlineImageUrl };
    case "frame":
      return subject.frame === undefined ? undefined : { _tag: "Frame", ...subject.frame };
  }
};

/**
 * The one artwork resolver (SPEC 7.4): the first picture a step of `order` finds (the guide's
 * image or one found online for the title, a frame from the recording), else generated artwork
 * from genre, title and channel. Never a grey box.
 */
export const resolveArtwork = (
  subject: ArtworkSubject,
  order: ArtworkOrder = defaultArtworkOrder,
): Artwork => {
  for (const step of order) {
    const picture = pictureFor(step, subject);
    if (picture !== undefined) return picture;
  }
  return {
    _tag: "Generated",
    style: artworkStyle(subject.categories, subject.title),
    seed: titleSeed(subject.title),
    channelId: subject.channelId,
  };
};
