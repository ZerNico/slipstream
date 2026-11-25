import { DateTime } from "effect";
import type { Collection } from "../src/collection.ts";
import type { GroupSubject, PathLabels } from "../src/grouping.ts";
import { ChannelId, CollectionId, ProgrammeId, RuleId, UserId } from "../src/ids.ts";
import { emptyMatcher, type Matcher } from "../src/matcher.ts";
import type { Programme } from "../src/programme.ts";
import type { Rule } from "../src/rule.ts";
import { localParts, type Instant } from "../src/time.ts";

/** Fixtures shared by the domain tests. Not exported from the package. */

export const timeZone = "Europe/Berlin";

/** Parses an ISO instant. */
export const at = (iso: string): Instant => DateTime.makeUnsafe(iso);

export const skyF1 = ChannelId.make("sky-sport-f1");
export const skyBundesliga = ChannelId.make("sky-bundesliga");
export const eurosport = ChannelId.make("eurosport-1");
export const prosieben = ChannelId.make("prosieben");
export const daserste = ChannelId.make("das-erste");
export const arte = ChannelId.make("arte");

const alice = UserId.make("alice");

/** Builds a programme with sensible defaults. */
export const programme = (
  fields: Partial<Programme> & Pick<Programme, "channelId" | "title" | "start" | "end">,
): Programme => ({
  id: ProgrammeId.make(`${fields.channelId}:${DateTime.formatIso(fields.start)}`),
  categories: [],
  repeat: false,
  live: false,
  ...fields,
});

/** Builds a recording-like grouping subject from a programme. */
export const subject = (
  fields: Partial<GroupSubject> & Pick<GroupSubject, "channelId" | "title" | "start" | "end">,
): GroupSubject => ({ categories: [], labels: [], repeat: false, ...fields });

/** Builds a rule with sensible defaults. */
export const rule = (id: string, matcher: Partial<Matcher>, fields: Partial<Rule> = {}): Rule => ({
  id: RuleId.make(id),
  name: id,
  enabled: true,
  ownerId: alice,
  matcher: { ...emptyMatcher, ...matcher },
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  retention: { _tag: "KeepAll" },
  skipRepeats: false,
  offerDeclined: false,
  createdAt: at("2026-11-01T00:00:00Z"),
  ...fields,
});

/** Builds a collection with sensible defaults. */
export const collection = (
  id: string,
  name: string,
  fields: Partial<Omit<Collection, "matcher">> & { readonly matcher?: Partial<Matcher> } = {},
): Collection => ({
  id: CollectionId.make(id),
  name,
  rank: 0,
  labels: [],
  layout: { parts: [], path: [] },
  ...fields,
  matcher: { ...emptyMatcher, ...fields.matcher },
});

const weekdays = { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" };
const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const longMonths = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** German labels matching the design doc's grouping table. Real ones come from i18n. */
export const germanLabels: PathLabels = {
  other: "Other",
  films: "Films",
  season: (season) => `Staffel ${season}`,
  episode: (episode, subtitle) =>
    subtitle === undefined ? `Folge ${episode}` : `Folge ${episode} · ${subtitle}`,
  month: (year, month) => `${longMonths[month - 1]} ${year}`,
  airing: (start) => {
    const parts = localParts(start, timeZone);
    const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
    return `${weekdays[parts.weekday]} ${parts.day}. ${months[parts.month - 1]}, ${time}`;
  },
  film: (title, year) => (year === undefined ? title : `${title} (${year})`),
};
