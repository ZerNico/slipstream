import { Schema } from "effect";

/*
 * Which streams and channels are one channel. A channel key is a name without what varies
 * between copies; only the same guide id (`sameGuide`) is strong enough to act on alone, the
 * same key (`similarName`) is a suggestion someone confirms.
 */

/** How good a copy of a channel is, from its name. */
export const StreamQuality = Schema.Literals(["uhd", "fhd", "hd", "sd", "unknown"]);
export type StreamQuality = typeof StreamQuality.Type;

/** Why two channels or a stream and a channel look like the same channel. */
export const MatchReason = Schema.Literals(["sameGuide", "similarName"]);
export type MatchReason = typeof MatchReason.Type;

const qualityTokens: ReadonlyArray<readonly [StreamQuality, RegExp]> = [
  ["uhd", /^(?:uhd|4k|8k|2160[pi]?)$/u],
  ["fhd", /^(?:fhd|fullhd|1080[pi]?)$/u],
  ["hd", /^(?:hd|720[pi]?|hdtv)$/u],
  ["sd", /^(?:sd|576[pi]?|480[pi]?)$/u],
];

/** Tokens that only say how a copy is encoded; dropped from the key. */
const codecToken =
  /^(?:hevc|h\.?26[45]|x26[45]|avc|av1|hdr|hdr10|sdr|\d{2,3}fps|fps|50p|25p|raw|uhd|4k|8k|2160[pi]?|fhd|fullhd|1080[pi]?|hd|720[pi]?|hdtv|sd|576[pi]?|480[pi]?)$/u;

/** Two-letter country codes and a few three-letter ones playlists put before or after names. */
const countryCodes = new Set([
  "GER",
  "DEU",
  "AUT",
  "SUI",
  "CHE",
  "USA",
  "ENG",
  "FRA",
  "ITA",
  "ESP",
  "NLD",
  "POL",
  "TUR",
  "EXYU",
]);
const isCountry = (code: string) => /^[A-Z]{2}$/u.test(code) || countryCodes.has(code);

/** Well-known second names of one channel. Kept tiny: a wrong entry would claim channels. */
const aliases: Readonly<Record<string, string>> = {
  arddaserste: "daserste",
  ard: "daserste",
};

/** Lower case, accents gone, `+` kept (a "+1" channel is another channel). */
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Removes a leading or trailing country marker: "DE: ", "DE | ", "|DE| ", "[DE] ", "(DE)". */
const stripCountry = (name: string): string => {
  let rest = name.trim();
  for (;;) {
    const lead =
      /^[|[(]\s*([A-Za-z]{2,4})\s*[|\])]\s*[:|\-–]?\s*/u.exec(rest) ??
      /^([A-Z]{2,4})\s*(?:[:|]|\s[-–])\s*/u.exec(rest);
    if (lead === null || !isCountry((lead[1] ?? "").toUpperCase())) break;
    if (lead[0].length >= rest.length) break;
    rest = rest.slice(lead[0].length);
  }
  const trail = /\s*(?:[|[(]\s*([A-Za-z]{2,4})\s*[|\])]|[|\-–]\s*([A-Z]{2,4}))$/u.exec(rest);
  const code = (trail?.[1] ?? trail?.[2] ?? "").toUpperCase();
  if (trail !== null && isCountry(code) && trail.index > 0) rest = rest.slice(0, trail.index);
  return rest;
};

/** The words of a name after the country marker, brackets opened, punctuation as spaces. */
const words = (name: string): Array<string> =>
  fold(stripCountry(name))
    // "H.265" stays one token; other dots split ("Sat.1" becomes "sat 1").
    .replace(/\bh\.(26[45])\b/gu, "h$1")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");

/**
 * A channel's key: its name folded so copies of one channel compare equal. Lower case, accents
 * and punctuation gone, without quality and codec tags (HD, FHD, UHD, 4K, SD, HEVC, H.265,
 * 50fps…) and country markers ("DE:", "DE |", "[DE]", "|DE|"). `undefined` when nothing is left
 * ("HD"), since such a name says nothing about the channel.
 *
 * "Das Erste HD", "ARD Das Erste FHD" and "DE: Das Erste SD" all give `daserste`; "Sat.1" and
 * "SAT 1 HD" give `sat1`; "kabel eins" (`kabeleins`) and "Kabel 1" (`kabel1`) stay apart.
 */
export const channelKey = (name: string): string | undefined => {
  const kept = words(name).filter((word) => !codecToken.test(word));
  const key = kept.join("");
  if (key === "") return undefined;
  return aliases[key] ?? key;
};

/** The quality a stream's name claims; `unknown` when it names none. */
export const streamQuality = (name: string): StreamQuality => {
  const tokens = words(name);
  for (const [quality, pattern] of qualityTokens) {
    if (tokens.some((token) => pattern.test(token))) return quality;
  }
  return "unknown";
};

/** Higher is better: UHD 4, FHD 3, HD 2, SD 1, unknown 0. */
export const qualityRank = (quality: StreamQuality): number => {
  switch (quality) {
    case "uhd":
      return 4;
    case "fhd":
      return 3;
    case "hd":
      return 2;
    case "sd":
      return 1;
    case "unknown":
      return 0;
  }
};

/**
 * Streams grouped into channels: copies with the same key form one group, best quality first
 * (playlist order among equals), so the first is the channel's stream and the rest its
 * fallbacks. Streams without a key stay on their own. Groups come in the order of their first
 * stream in the input.
 */
export const groupVariants = <A extends { readonly name: string }>(
  streams: ReadonlyArray<A>,
): Array<Array<A>> => {
  const groups: Array<Array<A>> = [];
  const byKey = new Map<string, Array<A>>();
  for (const stream of streams) {
    const key = channelKey(stream.name);
    const known = key === undefined ? undefined : byKey.get(key);
    if (known !== undefined) {
      known.push(stream);
      continue;
    }
    const group = [stream];
    groups.push(group);
    if (key !== undefined) byKey.set(key, group);
  }
  return groups.map((group) =>
    group.toSorted(
      (a, b) => qualityRank(streamQuality(b.name)) - qualityRank(streamQuality(a.name)),
    ),
  );
};

const add = (map: Map<string, Set<string>>, key: string, id: string) =>
  map.set(key, (map.get(key) ?? new Set()).add(id));

/** The single id in `ids`; `undefined` for none or several. */
const only = (ids: ReadonlySet<string> | undefined) =>
  ids !== undefined && ids.size === 1 ? [...ids][0] : undefined;

/** A channel as matching sees it: its name and every guide id it is known by. */
export interface MatchableChannel {
  readonly id: string;
  readonly name: string;
  /** Its guide channel id and the tvg-ids of its streams. */
  readonly guideIds: ReadonlyArray<string>;
}

/** A stream as matching sees it. */
export interface MatchableStream {
  readonly name: string;
  readonly tvgId?: string | undefined;
}

/** The channel a stream belongs to, and why. */
export interface ChannelMatch {
  readonly channelId: string;
  readonly reason: MatchReason;
}

/**
 * Finds the existing channel a stream belongs to: the one channel known by the stream's tvg-id
 * (`sameGuide`), else the one channel with the stream's key (`similarName`). When several
 * channels qualify the answer is ambiguous and there is none.
 */
export const streamMatcher = (
  channels: ReadonlyArray<MatchableChannel>,
): ((stream: MatchableStream) => ChannelMatch | undefined) => {
  const byGuide = new Map<string, Set<string>>();
  const byKey = new Map<string, Set<string>>();
  for (const channel of channels) {
    for (const guideId of channel.guideIds) if (guideId !== "") add(byGuide, guideId, channel.id);
    const key = channelKey(channel.name);
    if (key !== undefined) add(byKey, key, channel.id);
  }
  return (stream) => {
    if (stream.tvgId !== undefined && stream.tvgId !== "") {
      const ids = byGuide.get(stream.tvgId);
      const id = only(ids);
      if (id !== undefined) return { channelId: id, reason: "sameGuide" };
      if (ids !== undefined) return undefined;
    }
    const key = channelKey(stream.name);
    const id = key === undefined ? undefined : only(byKey.get(key));
    return id === undefined ? undefined : { channelId: id, reason: "similarName" };
  };
};

/** Channels that look like one channel; the first is the one to keep. */
export interface MergeSuggestion {
  readonly channelIds: ReadonlyArray<string>;
  readonly reason: MatchReason;
}

/** One key for a pair of channel ids, whichever comes first. */
export const channelPairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Splits a group so no two channels an admin kept apart end up together: each channel joins
 * the first part with none of its kept-apart channels, else starts a new one.
 */
const keepApart = (
  members: ReadonlyArray<number>,
  channels: ReadonlyArray<MatchableChannel>,
  apart: ReadonlySet<string>,
): Array<Array<number>> => {
  if (apart.size === 0) return [[...members]];
  const parts: Array<Array<number>> = [];
  const id = (index: number) => channels[index]?.id ?? "";
  for (const index of members) {
    const part = parts.find((candidate) =>
      candidate.every((other) => !apart.has(channelPairKey(id(other), id(index)))),
    );
    if (part === undefined) parts.push([index]);
    else part.push(index);
  }
  return parts;
};

/**
 * Channels that look like copies of one another, for "merge these?". Channels sharing a guide
 * id (directly or through another channel) form a `sameGuide` group; of the rest, channels with
 * the same key form a `similarName` group. Pass the channels in lineup order: each group keeps
 * that order, so its first channel is the one to keep, and groups come in the order of their
 * first channel. Pairs in `apart` (see `channelPairKey`) were said not to be the same and are
 * never suggested together.
 */
export const mergeSuggestions = (
  channels: ReadonlyArray<MatchableChannel>,
  apart: ReadonlySet<string> = new Set(),
): Array<MergeSuggestion> => {
  // Union-find over channels joined by a shared guide id.
  const parent = channels.map((_, index) => index);
  const root = (index: number): number => {
    let at = index;
    while (parent[at] !== at) at = parent[at] ?? at;
    return at;
  };
  const owner = new Map<string, number>();
  channels.forEach((channel, index) => {
    for (const guideId of channel.guideIds) {
      if (guideId === "") continue;
      const other = owner.get(guideId);
      if (other === undefined) owner.set(guideId, index);
      else {
        const [a, b] = [root(other), root(index)];
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const byRoot = new Map<number, Array<number>>();
  channels.forEach((_, index) => {
    const at = root(index);
    byRoot.set(at, [...(byRoot.get(at) ?? []), index]);
  });
  const result: Array<{ first: number; suggestion: MergeSuggestion }> = [];
  const grouped = new Set<number>();
  for (const group of byRoot.values()) {
    if (group.length < 2) continue;
    for (const index of group) grouped.add(index);
    for (const members of keepApart(group, channels, apart)) {
      if (members.length < 2) continue;
      result.push({
        first: members[0] ?? 0,
        suggestion: {
          channelIds: members.map((index) => channels[index]?.id ?? ""),
          reason: "sameGuide",
        },
      });
    }
  }
  const byKey = new Map<string, Array<number>>();
  channels.forEach((channel, index) => {
    if (grouped.has(index)) return;
    const key = channelKey(channel.name);
    if (key !== undefined) byKey.set(key, [...(byKey.get(key) ?? []), index]);
  });
  for (const group of byKey.values()) {
    for (const members of keepApart(group, channels, apart)) {
      if (members.length < 2) continue;
      result.push({
        first: members[0] ?? 0,
        suggestion: {
          channelIds: members.map((index) => channels[index]?.id ?? ""),
          reason: "similarName",
        },
      });
    }
  }
  return result.toSorted((a, b) => a.first - b.first).map((entry) => entry.suggestion);
};

/** A guide channel as mapping sees it. */
export interface MatchableGuideChannel {
  readonly xmltvId: string;
  readonly displayName: string;
}

/** The key of an XMLTV id: without a trailing country domain or `@variant` ("ZDF.de@SD"). */
const guideIdKey = (xmltvId: string): string | undefined =>
  channelKey(xmltvId.replace(/@[^@]*$/u, "").replace(/\.[a-z]{2,3}$/iu, ""));

/**
 * Guide channels a channel likely takes its guide from: those whose id one of its streams
 * carries as tvg-id (`sameGuide`) first, then those whose name or id gives the channel's key
 * (`similarName`), each once, in the order given.
 */
export const guideSuggestions = <G extends MatchableGuideChannel>(
  channel: { readonly name: string; readonly tvgIds: ReadonlyArray<string> },
  guides: ReadonlyArray<G>,
): Array<{ readonly guide: G; readonly reason: MatchReason }> => {
  const tvgIds = new Set(channel.tvgIds);
  const key = channelKey(channel.name);
  const same = guides.filter((guide) => tvgIds.has(guide.xmltvId));
  const similar =
    key === undefined
      ? []
      : guides.filter(
          (guide) =>
            !tvgIds.has(guide.xmltvId) &&
            (channelKey(guide.displayName) === key || guideIdKey(guide.xmltvId) === key),
        );
  return [
    ...same.map((guide) => ({ guide, reason: "sameGuide" as const })),
    ...similar.map((guide) => ({ guide, reason: "similarName" as const })),
  ];
};
