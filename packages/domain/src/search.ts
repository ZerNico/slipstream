import type { DateTime } from "effect";
import { guideChannelOrder } from "./channel.ts";
import { isPlayable, type RecordingState } from "./recording.ts";
import { epochMs } from "./time.ts";

/*
 * Search for the web palette and the app (SPEC §4): matching, grouping, what is on now, recent
 * searches. The server searches the guide; channels and recordings are matched here.
 */

/** The shortest query the guide is searched for: one letter matches half the guide. */
export const guideSearchMin = 2;

/** Whether a query is long enough to ask the server's guide search. */
export const searchesGuide = (query: string): boolean => query.trim().length >= guideSearchMin;

/** What a query is compared with: trimmed and lower case. */
export const searchNeedle = (query: string): string => query.trim().toLocaleLowerCase();

/**
 * Whether any of `fields` contains the query, case-insensitively. Fields are read as one line,
 * so "sky 12" finds a channel named "Sky" numbered 12. An empty query matches nothing.
 */
export const matchesSearch = (query: string, fields: readonly (string | undefined)[]): boolean => {
  const needle = searchNeedle(query);
  return (
    needle !== "" &&
    fields
      .filter((field) => field !== undefined)
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle)
  );
};

/** One result of a grouped search: its group, its words, and whether the server matched it. */
export interface SearchOption<G extends string> {
  readonly group: G;
  readonly title: string;
  readonly meta?: string | undefined;
  /** Already matched by the server (guide search), so it is not filtered again. */
  readonly matched?: boolean | undefined;
}

/**
 * Filters and orders options for a query: title and meta must contain the query (options the
 * server matched pass as they are), groups come in `order`, at most `perGroup` each. An empty
 * query shows only the `whenEmpty` group (the palette's actions), or nothing.
 */
export const filterSearchOptions = <G extends string, O extends SearchOption<G>>(
  options: readonly O[],
  query: string,
  order: readonly G[],
  settings: { readonly perGroup: number; readonly whenEmpty?: G },
): O[] => {
  const empty = searchNeedle(query) === "";
  const matches = options.filter((option) =>
    empty
      ? option.group === settings.whenEmpty
      : option.matched === true || matchesSearch(query, [option.title, option.meta]),
  );
  return order.flatMap((group) =>
    matches.filter((option) => option.group === group).slice(0, settings.perGroup),
  );
};

/** What channel search reads of a channel. */
export interface SearchedChannel {
  readonly name: string;
  readonly number?: number;
  readonly hidden: boolean;
}

/**
 * The visible channels whose name or number contains the query, those whose name starts with
 * it first, then in guide order.
 */
export const searchChannels = <C extends SearchedChannel>(
  channels: readonly C[],
  query: string,
  limit: number,
): C[] => {
  const needle = searchNeedle(query);
  const starts = (channel: C) => (channel.name.toLocaleLowerCase().startsWith(needle) ? 0 : 1);
  return channels
    .filter(
      (channel) =>
        !channel.hidden &&
        matchesSearch(query, [
          channel.name,
          channel.number === undefined ? undefined : String(channel.number),
        ]),
    )
    .toSorted((a, b) => starts(a) - starts(b) || guideChannelOrder(a, b))
    .slice(0, limit);
};

/** What recording search reads of a recording. */
export interface SearchedRecording {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly state: RecordingState;
  readonly start: DateTime.Utc;
}

/**
 * The recordings whose title or episode title contains the query: something to watch first
 * (newest first), then the rest (scheduled, failed) by start. Cancelled ones are left out.
 */
export const searchRecordings = <R extends SearchedRecording>(
  recordings: readonly R[],
  query: string,
  limit: number,
): R[] => {
  // Something to watch first, before what is still to come.
  const rank = (entry: R) => (isPlayable(entry) ? 0 : 1);
  return recordings
    .filter(
      (entry) => entry.state !== "cancelled" && matchesSearch(query, [entry.title, entry.subtitle]),
    )
    .toSorted(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) === 0 ? epochMs(b.start) - epochMs(a.start) : epochMs(a.start) - epochMs(b.start)),
    )
    .slice(0, limit);
};

/** What the airing split reads of a programme. */
export interface AiringProgramme {
  readonly start: DateTime.Utc;
  readonly end: DateTime.Utc;
}

/** Guide results split into what is on now and what is still to come; ended ones are dropped. */
export const splitByAiring = <P extends AiringProgramme>(
  programmes: readonly P[],
  now: number,
): { readonly onNow: P[]; readonly comingUp: P[] } => ({
  onNow: programmes.filter((p) => epochMs(p.start) <= now && epochMs(p.end) > now),
  comingUp: programmes.filter((p) => epochMs(p.start) > now),
});

/** How many recent searches a device keeps. */
export const recentSearchLimit = 8;

/**
 * The recent searches with `query` put first: trimmed, an earlier copy (in any case) dropped,
 * at most {@link recentSearchLimit}. A query too short to search the guide is not kept.
 */
export const rememberSearch = (recent: readonly string[], query: string): string[] => {
  const kept = query.trim();
  if (kept.length < guideSearchMin) return [...recent];
  const needle = kept.toLocaleLowerCase();
  return [kept, ...recent.filter((entry) => entry.toLocaleLowerCase() !== needle)].slice(
    0,
    recentSearchLimit,
  );
};

/** Recent searches read back from storage: a list of strings, else nothing. */
export const parseRecentSearches = (raw: string | null): string[] => {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
          .slice(0, recentSearchLimit)
      : [];
  } catch {
    return [];
  }
};
