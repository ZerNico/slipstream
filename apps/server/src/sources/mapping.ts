/**
 * Pure mapping between source data and storage: M3U entries to stream rows, XMLTV programmes to
 * guide rows, and domain clean-up settings to adapter settings.
 */
import { createHash } from "node:crypto";
import type { GuideCleanup, PartialDate, Source, SourceConfig } from "@slipstream/domain";
import {
  type M3uEntry,
  type M3uXmltvConfig,
  stripUrl,
  type RewriteRule,
  type XmltvProgramme,
} from "@slipstream/sources";
import type { programmes } from "../db/schema.ts";

const httpUrl = /^https?:\/\/\S+$/;

/** True for URLs the API accepts (`HttpUrl` in the domain). */
export const isHttpUrl = (value: string | undefined): value is string =>
  value !== undefined && httpUrl.test(value);

/** Domain clean-up rewrites in the shape the sources adapter takes. */
export const toRewriteRules = (cleanup: GuideCleanup): Array<RewriteRule> =>
  cleanup.rewrites.map((rewrite) => {
    const field = rewrite.field === "subtitle" ? "subTitle" : "title";
    return { field, pattern: rewrite.pattern, set: { [field]: rewrite.replacement } };
  });

/** Adapter settings for an M3U source. */
export const adapterConfig = (
  config: Extract<SourceConfig, { readonly _tag: "M3u" }>,
  source: Pick<Source, "userAgent" | "headers" | "secretHeaders" | "guideCleanup">,
): M3uXmltvConfig => ({
  playlistUrl: config.playlistUrl,
  ...(config.guideUrl === undefined ? {} : { guideUrl: config.guideUrl }),
  ...(source.userAgent === undefined ? {} : { userAgent: source.userAgent }),
  headers: { ...source.headers, ...source.secretHeaders },
  removeDuplicates: source.guideCleanup.removeDuplicates,
  rewrites: toRewriteRules(source.guideCleanup),
});

/** A stream row as the refresh writes it (without database ids). */
export interface StreamCandidate {
  readonly upstreamId: string;
  readonly name: string;
  readonly url: string;
  readonly tvgId: string | undefined;
  readonly logoUrl: string | undefined;
  readonly group: string | undefined;
  readonly channelNumber: string | undefined;
  /** What the playlist asks to send when fetching this stream; captures pass both on. */
  readonly userAgent: string | undefined;
  readonly referrer: string | undefined;
}

/** How ffmpeg asks for one stream: a user agent and request headers. */
export interface StreamRequest {
  readonly userAgent?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * How ffmpeg asks for one stream: the playlist's own user agent for it before the source's, and
 * its referrer as `Referer` (in place of one the source sets) beside the source's headers for
 * that URL (`streamRequestHeaders`). Providers that check either refuse a capture without them.
 */
export const streamRequest = (
  sourceUserAgent: string | undefined,
  sourceHeaders: Readonly<Record<string, string>>,
  stream: { readonly userAgent: string | null; readonly referrer: string | null },
): StreamRequest => {
  const userAgent = stream.userAgent ?? sourceUserAgent;
  const headers =
    stream.referrer === null
      ? sourceHeaders
      : {
          ...Object.fromEntries(
            Object.entries(sourceHeaders).filter(([name]) => name.toLowerCase() !== "referer"),
          ),
          Referer: stream.referrer,
        };
  return {
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };
};

/**
 * The upstream id of a stream with neither tvg-id nor name: `url:` and a hash of its URL without
 * user info, query or fragment (`stripUrl`), so it is stable when providers rotate tokens and
 * never stores the credentials a stream URL carries (it is shown through the API).
 */
const urlUpstreamId = (url: string): string =>
  `url:${createHash("sha256").update(stripUrl(url)).digest("base64url").slice(0, 22)}`;

/**
 * Turns playlist entries into streams. The upstream id is the tvg-id, else the name, else a hash
 * of the URL (`urlUpstreamId`), so it stays stable when providers rotate tokens in stream URLs;
 * repeats get a `#2`, `#3` suffix. An entry without a name of its own (the parser then names it
 * by its URL) is named by its redacted URL, so no credential becomes a stream or channel name.
 * Entries whose URL is not http(s) are skipped.
 */
export const streamCandidates = (entries: ReadonlyArray<M3uEntry>): Array<StreamCandidate> => {
  const seen = new Map<string, number>();
  const result: Array<StreamCandidate> = [];
  for (const entry of entries) {
    if (!isHttpUrl(entry.url)) continue;
    const named = entry.name.trim() === entry.url.trim() ? "" : entry.name.trim();
    const base = entry.tvgId?.trim() || named || urlUpstreamId(entry.url);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    result.push({
      upstreamId: count === 1 ? base : `${base}#${count}`,
      name: named === "" ? stripUrl(entry.url) : entry.name,
      url: entry.url,
      tvgId: entry.tvgId?.trim() || undefined,
      logoUrl: isHttpUrl(entry.tvgLogo) ? entry.tvgLogo : undefined,
      group: entry.groupTitle,
      channelNumber: entry.channelNumber,
      userAgent: entry.userAgent,
      referrer: entry.referrer,
    });
  }
  return result;
};

/** A stable programme id: the same airing keeps its id across refreshes. */
export const programmeId = (sourceId: string, guideChannelId: string, start: number): string =>
  createHash("sha256")
    .update(`${sourceId}\u0000${guideChannelId}\u0000${start}`)
    .digest("base64url")
    .slice(0, 22);

/** XMLTV `<date>`: `2026`, `202611` or `20261121` (anything after the digits is ignored). */
export const parseXmltvDate = (value: string | undefined): PartialDate | undefined => {
  const match = /^(\d{4})(\d{2})?(\d{2})?/.exec(value?.trim() ?? "");
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = match[2] === undefined ? undefined : Number(match[2]);
  const day = match[3] === undefined ? undefined : Number(match[3]);
  return {
    year,
    ...(month !== undefined && month >= 1 && month <= 12 ? { month } : {}),
    ...(day !== undefined && day >= 1 && day <= 31 && month !== undefined ? { day } : {}),
  };
};

/** A programme row ready to insert, or `undefined` when the entry has no usable stop time. */
export const programmeRow = (
  sourceId: string,
  programme: XmltvProgramme,
): typeof programmes.$inferInsert | undefined => {
  if (programme.stop === undefined || programme.stop <= programme.start) return undefined;
  const episode =
    programme.episode?.season === undefined && programme.episode?.episode === undefined
      ? null
      : {
          ...(programme.episode.season === undefined ? {} : { season: programme.episode.season }),
          ...(programme.episode.episode === undefined
            ? {}
            : { episode: programme.episode.episode }),
        };
  return {
    id: programmeId(sourceId, programme.channel, programme.start),
    sourceId,
    guideChannelId: programme.channel,
    start: programme.start,
    end: programme.stop,
    title: programme.title,
    subtitle: programme.subTitle ?? null,
    description: programme.description ?? null,
    categories: programme.categories,
    episode,
    originalAirDate: parseXmltvDate(programme.date) ?? null,
    repeat: programme.previouslyShown,
    live: programme.live,
    imageUrl: isHttpUrl(programme.icon) ? programme.icon : null,
  };
};

/** A channel number from the playlist (`tvg-chno`), when it is a whole number. */
export const parseChannelNumber = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};
