import { Schema, Struct } from "effect";
import { ChannelId, ChannelStreamId, SourceStreamId } from "./ids.ts";
import { HttpUrl } from "./source.ts";

/** A curated channel: what people see in the guide and tune to. */
export const Channel = Schema.Struct({
  id: ChannelId,
  name: Schema.NonEmptyString,
  number: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  logoUrl: Schema.optionalKey(HttpUrl),
  /** XMLTV channel id the guide data is mapped from (auto by tvg-id, or a manual override). */
  guideChannelId: Schema.optionalKey(Schema.String),
  favourite: Schema.Boolean,
  hidden: Schema.Boolean,
}).annotate({ identifier: "Channel" });
export type Channel = typeof Channel.Type;

/** What an admin sends to create a channel. */
export const ChannelInput = Channel.mapFields(Struct.omit(["id"])).annotate({
  identifier: "ChannelInput",
});
export type ChannelInput = typeof ChannelInput.Type;

/**
 * A partial update; absent fields stay as they are. `logoUrl: null` goes back to the automatic
 * logo (the guide channel's icon, else the channel's short mark); `guideChannelId: null` leaves
 * the channel without a guide.
 */
export const ChannelUpdate = ChannelInput.mapFields((fields) => ({
  ...Struct.map(fields, Schema.optionalKey),
  logoUrl: Schema.optionalKey(Schema.NullOr(HttpUrl)),
  guideChannelId: Schema.optionalKey(Schema.NullOr(Schema.String)),
})).annotate({
  identifier: "ChannelUpdate",
});
export type ChannelUpdate = typeof ChannelUpdate.Type;

/** Links a channel to one source stream. Lower `priority` is tried first; the rest are fallbacks. */
export const ChannelStream = Schema.Struct({
  id: ChannelStreamId,
  channelId: ChannelId,
  sourceStreamId: SourceStreamId,
  priority: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "ChannelStream" });
export type ChannelStream = typeof ChannelStream.Type;

/**
 * Guide order for channels: by number with unnumbered channels last, then by name. The server's
 * channel list, the web guide, Home and the player's channel panel, and the TV guide all sort
 * with it.
 */
export const guideChannelOrder = (
  a: Pick<Channel, "number" | "name">,
  b: Pick<Channel, "number" | "name">,
): number =>
  (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name);

/** The channels people see, in guide order: hidden ones left out. */
export const visibleChannels = <A extends Pick<Channel, "number" | "name" | "hidden">>(
  channels: ReadonlyArray<A>,
): Array<A> => channels.filter((channel) => !channel.hidden).toSorted(guideChannelOrder);

const markLength = 5;
const qualityTag = /\s+(?:U?HD|FHD|SD|4K)$/iu;

/** A channel's name as cards and rows show it: without a trailing quality tag ("Das Erste HD"). */
export const displayChannelName = (name: string): string => name.trim().replace(qualityTag, "");

/** The initials of the words with numbers kept whole, as many whole pieces as fit in five. */
const initials = (words: ReadonlyArray<string>): string => {
  let mark = "";
  for (const word of words) {
    const piece = /^\d+$/u.test(word) ? word : word.charAt(0).toUpperCase();
    if (mark.length + piece.length > markLength) break;
    mark += piece;
  }
  return mark;
};

/**
 * A channel's short mark for its logo chip and the corner of generated art when it has no logo
 * (SPEC §7.4), at most five characters and cut on word boundaries only, never into a stub like
 * "Kunte" or "Klass":
 *
 * - one word of up to five characters stays whole ("ZDF", "arte", "3sat");
 * - a longer single word gives the initials of its capitalised parts ("ProSieben" is "PS"),
 *   else its first letter ("Kunterbunt" is "K");
 * - of several words, a last word that says something and fits stays whole ("Das Erste" is
 *   "Erste", "Sky Sport F1 HD" is "F1");
 * - else the initials with any number ("Sky Sport 1" is "SS1", "Kino Klassik" is "KK").
 *
 * A trailing quality tag (HD, SD, UHD, 4K) is ignored. One rule everywhere, so a channel looks
 * the same in the guide, the library, Settings and on the TV.
 */
export const channelMark = (name: string): string => {
  const words = name.trim().replace(qualityTag, "").split(/\s+/u).filter(Boolean);
  const [first] = words;
  if (first === undefined) return "";
  if (words.length === 1) {
    if (first.length <= markLength) return first;
    const parts = first.match(/\p{Lu}[^\p{Lu}]*/gu) ?? [];
    return parts.length >= 2 ? initials(parts) : first.charAt(0).toUpperCase();
  }
  const last = words.at(-1) ?? "";
  if (last.length >= 2 && last.length <= markLength && /\p{L}/u.test(last)) return last;
  return initials(words);
};
