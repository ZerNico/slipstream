import { Schema } from "effect";
import { ChannelId, ProgrammeId } from "./ids.ts";
import { HttpUrl } from "./source.ts";
import { Instant } from "./time.ts";

const Positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** Season and episode numbers from the guide, 1-based (XMLTV `xmltv_ns` is 0-based on the wire). */
export const EpisodeInfo = Schema.Struct({
  season: Schema.optionalKey(Positive),
  episode: Schema.optionalKey(Positive),
}).annotate({ identifier: "EpisodeInfo" });
export type EpisodeInfo = typeof EpisodeInfo.Type;

/** A date the guide may only know partly (XMLTV `<date>` is often just a year). */
export const PartialDate = Schema.Struct({
  year: Schema.Int,
  month: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))),
  day: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 }))),
}).annotate({ identifier: "PartialDate" });
export type PartialDate = typeof PartialDate.Type;

/** The metadata that grouping and matching read; shared by programmes and recordings. */
export const ProgrammeInfo = Schema.Struct({
  channelId: ChannelId,
  start: Instant,
  end: Instant,
  title: Schema.String,
  subtitle: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  categories: Schema.Array(Schema.String),
  episode: Schema.optionalKey(EpisodeInfo),
  /** First broadcast or production date; for films the release year. */
  originalAirDate: Schema.optionalKey(PartialDate),
  /** The guide marks this airing as a repeat. */
  repeat: Schema.Boolean,
  live: Schema.Boolean,
  imageUrl: Schema.optionalKey(HttpUrl),
  /**
   * A picture found online for this title (TMDB, with the household's key), when the guide has
   * none. Filled in by the server in the background; absent until found.
   */
  onlineImageUrl: Schema.optionalKey(HttpUrl),
}).annotate({ identifier: "ProgrammeInfo" });
export type ProgrammeInfo = typeof ProgrammeInfo.Type;

/** One guide entry. */
export const Programme = Schema.Struct({ id: ProgrammeId, ...ProgrammeInfo.fields }).annotate({
  identifier: "Programme",
});
export type Programme = typeof Programme.Type;

/**
 * A programme as a guide grid draws it: what its cells, markers and arrow keys read. The
 * description, pictures and first air date stay out, since a week of guide would carry them for
 * every programme while only the one opened shows them; its own answer
 * (`GET /guide/programmes/:id`) has everything.
 */
export const GuideEntry = Schema.Struct({
  id: ProgrammeId,
  channelId: ChannelId,
  start: Instant,
  end: Instant,
  title: Schema.String,
  subtitle: Schema.optionalKey(Schema.String),
  categories: Schema.Array(Schema.String),
  episode: Schema.optionalKey(EpisodeInfo),
  repeat: Schema.Boolean,
  live: Schema.Boolean,
}).annotate({ identifier: "GuideEntry" });
export type GuideEntry = typeof GuideEntry.Type;

/** A programme's guide entry: the same fields, the details left out. */
export const toGuideEntry = (programme: Programme): GuideEntry => ({
  id: programme.id,
  channelId: programme.channelId,
  start: programme.start,
  end: programme.end,
  title: programme.title,
  ...(programme.subtitle === undefined ? {} : { subtitle: programme.subtitle }),
  categories: programme.categories,
  ...(programme.episode === undefined ? {} : { episode: programme.episode }),
  repeat: programme.repeat,
  live: programme.live,
});
