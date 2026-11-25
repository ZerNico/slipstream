import { Schema } from "effect";
import { isFilmCategory, isSportCategory } from "./category.ts";
import { ChannelId, type ProgrammeId, RecordingId, RuleId, UserId } from "./ids.ts";
import type { EpisodeInfo, PartialDate, ProgrammeInfo } from "./programme.ts";
import {
  isPlayable,
  isRangedProblem,
  type Recording,
  recordingGapSummary,
  type RecordingState,
} from "./recording.ts";
import { cleanTitle, hasRepeatMarker, isOnlyRepeatMarker, normaliseText } from "./title.ts";
import {
  calendarDayNumber,
  DAY,
  epochMs,
  HOUR,
  Instant,
  MINUTE,
  noPadding,
  summariseGaps,
} from "./time.ts";

/*
 * Episode identity (recording model §4): which airings are the same episode, so a series
 * recording leaves out what someone already has and finds the repeat of a damaged recording.
 * Rule of thumb: no identifying data, no repeat. When unsure, record.
 */

/** Missing programme time (start to end, not the extra time) from which a recording needs a repeat. */
export const repeatGapThresholdMs = MINUTE;

/** How long a damaged recording looks for its repeat after its programme ended. */
export const rerunWindowMs = 14 * DAY;

/** The most repeats one episode gets before the search gives up. */
export const rerunAttemptsMax = 2;

/**
 * How soon after a live Event ends an unmarked, not-live airing of it without the same sub-title
 * still counts as its replay (§4.2).
 */
export const liveReplayWindowMs = 12 * HOUR;

/** A repeat replaces the original only when its programme is at least this share as long. */
export const replacementMinLengthRatio = 0.9;

/**
 * The key a show is known by across channels and markers: "Live F1: Rennen - GP Katar" and
 * "F1: Rennen - GP Katar (Wh.)" share `f1: rennen - gp katar`.
 */
export const showKey = (title: string): string => normaliseText(cleanTitle(title)).toLowerCase();

const textKey = (text: string | undefined): string => normaliseText(text ?? "").toLowerCase();

/** The four ways an airing is identified (§4.1). */
export const EpisodeClass = Schema.Literals(["Event", "Episode", "Film", "Broadcast"]);
export type EpisodeClass = typeof EpisodeClass.Type;

/** What episode identity reads from a programme or a recording. */
export type EpisodeSubject = Pick<
  ProgrammeInfo,
  "channelId" | "start" | "end" | "title" | "categories" | "repeat" | "live"
> & {
  readonly subtitle?: string | undefined;
  readonly description?: string | undefined;
  readonly episode?: EpisodeInfo | undefined;
  readonly originalAirDate?: PartialDate | undefined;
};

/** What identity needs to know beyond the airing itself. */
export interface EpisodeContext {
  /** The household time zone: calendar days are local days. */
  readonly timeZone: string;
  /** Channel names, so a sub-title that only repeats the channel never identifies anything. */
  readonly channelName?: ((channelId: ChannelId) => string | undefined) | undefined;
  /** Pairs of show key and sub-title key that every airing of a show carries (`genericSubtitles`). */
  readonly genericSubtitles?: ReadonlySet<string> | undefined;
  /** Guide categories that mark a film; `defaultFilmCategories` when absent. */
  readonly filmCategories?: ReadonlyArray<string> | undefined;
}

const weekdayWords =
  "mo|di|mi|do|fr|sa|so|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const monthWords =
  "jan|feb|mär|mar|apr|mai|may|jun|jul|aug|sep|sept|okt|oct|nov|dez|dec|januar|january|februar|february|märz|march|april|juni|june|juli|july|august|september|oktober|october|november|dezember|december";
const weekdayOnly = new RegExp(`^(?:${weekdayWords})\\.?$`, "iu");
const numericDate = /^\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?\.?$/u;
const wordDate = new RegExp(
  `^(?:\\d{1,2}\\.?\\s*)?(?:${monthWords})\\.?(?:\\s*\\d{1,2}(?:st|nd|rd|th)?)?,?(?:\\s*\\d{2,4})?$`,
  "iu",
);

/**
 * Whether a sub-title only names a day: a date ("22.11.2026", "22. November"), a weekday
 * ("Sonntag"), or both, optionally after "vom" / "from" / "am" / "on".
 */
const isDateLike = (text: string): boolean => {
  const words = text
    .replace(/^(?:vom|von|am|from|on)\s+/iu, "")
    .split(/\s*,\s*|\s+(?=\d)/u)
    .map((word) => word.trim())
    .filter((word) => word !== "");
  if (words.length === 0) return false;
  const joined = words.join(" ");
  return (
    words.every((word) => weekdayOnly.test(word) || numericDate.test(word)) ||
    wordDate.test(joined) ||
    (weekdayOnly.test(words[0] ?? "") && wordDate.test(words.slice(1).join(" ")))
  );
};

const genericKey = (show: string, subtitle: string): string => `${show}\u0000${subtitle}`;

/**
 * Whether an airing's sub-title tells episodes apart (§4.1). It does not when it is empty, a
 * date, a weekday or a repeat marker; equal to the show, the channel's name or one of the
 * programme's categories; or generic for the show (`context.genericSubtitles`).
 */
export const isIdentifyingSubtitle = (
  info: Pick<EpisodeSubject, "title" | "subtitle" | "channelId" | "categories">,
  context: Pick<EpisodeContext, "channelName" | "genericSubtitles">,
): boolean => {
  const subtitle = normaliseText(info.subtitle ?? "");
  const key = subtitle.toLowerCase();
  if (key === "") return false;
  if (isDateLike(subtitle) || isOnlyRepeatMarker(subtitle)) return false;
  const show = showKey(info.title);
  if (key === show) return false;
  if (key === textKey(context.channelName?.(info.channelId))) return false;
  if (info.categories.some((category) => textKey(category) === key)) return false;
  return !(context.genericSubtitles?.has(genericKey(show, key)) ?? false);
};

/** An airing for `genericSubtitles`: guide programmes and recent recordings both fit. */
export type GenericSubtitleItem = Pick<EpisodeSubject, "title" | "subtitle" | "description"> & {
  readonly start: Instant;
};

/**
 * The (show, sub-title) pairs that do not identify an episode: seen on three or more distinct
 * local days with at least two different descriptions, or without any description. "Das
 * Magazin" every weekday is generic; a Tatort episode repeated three times with its one
 * description is not. Computed once per plan from the guide window and recent recordings.
 */
export const genericSubtitles = (
  items: ReadonlyArray<GenericSubtitleItem>,
  timeZone: string,
): ReadonlySet<string> => {
  const seen = new Map<
    string,
    { readonly days: Set<number>; readonly descriptions: Set<string>; bare: boolean }
  >();
  for (const item of items) {
    const subtitle = textKey(item.subtitle);
    if (subtitle === "") continue;
    const key = genericKey(showKey(item.title), subtitle);
    const entry = seen.get(key) ?? { days: new Set(), descriptions: new Set(), bare: false };
    entry.days.add(calendarDayNumber(item.start, timeZone));
    const description = textKey(item.description);
    if (description === "") entry.bare = true;
    else entry.descriptions.add(description);
    seen.set(key, entry);
  }
  const generic = new Set<string>();
  for (const [key, entry] of seen) {
    if (entry.days.size < 3) continue;
    if (entry.descriptions.size >= 2 || entry.descriptions.size === 0) generic.add(key);
  }
  return generic;
};

const isSport = (categories: ReadonlyArray<string>): boolean => categories.some(isSportCategory);

const isFilm = (categories: ReadonlyArray<string>, context: EpisodeContext): boolean =>
  categories.some((category) => isFilmCategory(category, context.filmCategories));

/** How an airing is identified, first match wins (§4.1). */
export type EpisodeIdentity =
  /** Date-identified: live, or sport without episode numbers. */
  | {
      readonly _tag: "Event";
      readonly showKey: string;
      readonly subtitleKey?: string | undefined;
    }
  /** Guide episode numbers, or an identifying sub-title. */
  | {
      readonly _tag: "Episode";
      readonly showKey: string;
      readonly season?: number | undefined;
      readonly episode?: number | undefined;
      readonly subtitleKey?: string | undefined;
    }
  /** A film category without episode data: identified by its year. */
  | { readonly _tag: "Film"; readonly showKey: string; readonly year?: number | undefined }
  /** Everything else, date-identified: news, talk shows, magazines. */
  | {
      readonly _tag: "Broadcast";
      readonly showKey: string;
      readonly subtitleKey?: string | undefined;
    };

/**
 * Sorts an airing into Event, Episode, Film or Broadcast (§4.1). Event comes first (next year's
 * race carries the same sub-title), Episode before Film (Tatort is often a "Fernsehfilm").
 */
export const episodeIdentity = (info: EpisodeSubject, context: EpisodeContext): EpisodeIdentity => {
  const key = showKey(info.title);
  const numbered = info.episode?.episode !== undefined;
  const anySubtitle = textKey(info.subtitle) || undefined;
  if (info.live || (isSport(info.categories) && !numbered)) {
    return { _tag: "Event", showKey: key, subtitleKey: anySubtitle };
  }
  const identifying = isIdentifyingSubtitle(info, context) ? anySubtitle : undefined;
  if (numbered || identifying !== undefined) {
    return {
      _tag: "Episode",
      showKey: key,
      season: info.episode?.season,
      episode: info.episode?.episode,
      subtitleKey: identifying,
    };
  }
  if (isFilm(info.categories, context)) {
    return { _tag: "Film", showKey: key, year: info.originalAirDate?.year };
  }
  return { _tag: "Broadcast", showKey: key, subtitleKey: anySubtitle };
};

/** One airing reduced to what the same-episode table compares. */
interface EpisodeFacts {
  readonly identity: EpisodeIdentity;
  readonly start: number;
  /** Programme length; 0 when unknown (history rows). */
  readonly lengthMs: number;
  readonly live: boolean;
  /** The guide's repeat flag or a repeat marker in the raw title: the explicit signals. */
  readonly marked: boolean;
  readonly sport: boolean;
  readonly description: string;
}

const factsOf = (info: EpisodeSubject, context: EpisodeContext): EpisodeFacts => ({
  identity: episodeIdentity(info, context),
  start: epochMs(info.start),
  lengthMs: epochMs(info.end) - epochMs(info.start),
  live: info.live,
  marked: info.repeat || hasRepeatMarker(info.title),
  sport: isSport(info.categories),
  description: normaliseText(info.description ?? ""),
});

/** The minimum length of both descriptions before the description guard applies. */
const guardMinLength = 40;

const words = (text: string): Set<string> =>
  new Set(
    text
      .slice(0, 300)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ""),
  );

/**
 * The description guard (§4.2): two long descriptions whose word sets overlap less than half
 * (Jaccard on the first 300 characters) describe different episodes.
 */
const descriptionsDiffer = (a: string, b: string): boolean => {
  if (a.length < guardMinLength || b.length < guardMinLength) return false;
  const left = words(a);
  const right = words(b);
  const shared = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union > 0 && shared / union < 0.5;
};

/**
 * Which row of the same-episode table a pair is judged by: its class when both agree. An Event
 * beside a Broadcast is an Event when either is sport (a replay flagged neither live nor sport)
 * and a Broadcast otherwise (news flagged live at 20:00, not at 00:00). Other mixes differ.
 */
const pairClass = (a: EpisodeFacts, b: EpisodeFacts): EpisodeClass | undefined => {
  const left = a.identity._tag;
  const right = b.identity._tag;
  if (left === right) return left;
  const pair = new Set([left, right]);
  if (pair.has("Event") && pair.has("Broadcast")) {
    return a.sport || b.sport ? "Event" : "Broadcast";
  }
  if (pair.has("Event") && pair.has("Episode") && (a.sport || b.sport)) return "Event";
  return undefined;
};

const subtitleOf = (identity: EpisodeIdentity): string | undefined =>
  identity._tag === "Film" ? undefined : identity.subtitleKey;

const sameFacts = (a: EpisodeFacts, b: EpisodeFacts, timeZone: string): boolean => {
  if (a.identity.showKey !== b.identity.showKey) return false;
  const kind = pairClass(a, b);
  const [earlier, later] = a.start <= b.start ? [a, b] : [b, a];
  switch (kind) {
    case undefined:
      return false;
    case "Episode": {
      if (a.identity._tag !== "Episode" || b.identity._tag !== "Episode") return false;
      const left = a.identity;
      const right = b.identity;
      let same: boolean;
      if (left.subtitleKey !== undefined && right.subtitleKey !== undefined) {
        same = left.subtitleKey === right.subtitleKey;
      } else if (left.episode !== undefined && right.episode !== undefined) {
        same = left.season === right.season && left.episode === right.episode;
      } else {
        same = false;
      }
      return same && !descriptionsDiffer(a.description, b.description);
    }
    case "Film":
      return (
        a.identity._tag === "Film" &&
        b.identity._tag === "Film" &&
        a.identity.year !== undefined &&
        a.identity.year === b.identity.year
      );
    case "Event": {
      const left = subtitleOf(a.identity);
      const right = subtitleOf(b.identity);
      if (left !== undefined && right !== undefined && left !== right) return false;
      const days =
        calendarDayNumber(later.start, timeZone) - calendarDayNumber(earlier.start, timeZone);
      if (days !== 0 && days !== 1) return false;
      if (later.marked) return true;
      // An unmarked replay needs a positive signal besides live → not live: the live airing's
      // sub-title again, or a start within 12 hours of the live airing's end. Next day's
      // unflagged Bundesliga match is another match.
      const replaySignal =
        (left !== undefined && left === right) ||
        later.start - (earlier.start + earlier.lengthMs) <= liveReplayWindowMs;
      return (
        earlier.live &&
        !later.live &&
        earlier.lengthMs > 0 &&
        Math.abs(later.lengthMs - earlier.lengthMs) <= 0.2 * earlier.lengthMs &&
        replaySignal
      );
    }
    case "Broadcast": {
      const left = subtitleOf(a.identity);
      const right = subtitleOf(b.identity);
      if (left !== undefined && right !== undefined && left !== right) return false;
      return later.start - earlier.start <= 24 * HOUR && later.marked;
    }
  }
};

/** Whether two airings are the same episode, by the table of §4.2. */
export const sameEpisode = (
  a: EpisodeSubject,
  b: EpisodeSubject,
  context: EpisodeContext,
): boolean => sameFacts(factsOf(a, context), factsOf(b, context), context.timeZone);

/**
 * Whether a recording needs a repeat (§5.1): it failed, nothing usable was captured, or at least
 * a minute of the programme itself (start to end, not the extra time) is missing.
 */
export const needsRepeat = (
  recording: Pick<Recording, "state" | "problems" | "start" | "end" | "padding">,
): boolean => {
  if (recording.state === "cancelled" || recording.state === "scheduled") return false;
  if (recording.state === "failed" || recordingGapSummary(recording).failed) return true;
  const missing = summariseGaps(
    recording.problems.filter(isRangedProblem).map((problem) => problem.range),
    { start: recording.start, end: recording.end },
  ).missingMs;
  return missing >= repeatGapThresholdMs;
};

/**
 * A recording as episode matching sees it: the airing it holds, its state and who has it.
 * `Recording` and library entries fit; planned airings fit without an id.
 */
export type EpisodeRecording = EpisodeSubject &
  Pick<Recording, "state" | "problems" | "padding"> & {
    readonly id?: RecordingId | undefined;
    readonly programmeId?: ProgrammeId | undefined;
    readonly ruleId?: RuleId | undefined;
    readonly ownerIds: ReadonlyArray<UserId>;
    readonly hiddenAt?: Instant | undefined;
    readonly replacesId?: RecordingId | undefined;
  };

/** One episode someone had and deleted, so it is not recorded again (§3.6). */
export const EpisodeHistoryEntry = Schema.Struct({
  userId: UserId,
  ruleId: Schema.optionalKey(RuleId),
  showKey: Schema.String,
  class: EpisodeClass,
  season: Schema.optionalKey(Schema.Int),
  episode: Schema.optionalKey(Schema.Int),
  subtitleKey: Schema.optionalKey(Schema.String),
  filmYear: Schema.optionalKey(Schema.Int),
  airedAt: Instant,
  channelId: ChannelId,
  title: Schema.String,
}).annotate({ identifier: "EpisodeHistoryEntry" });
export type EpisodeHistoryEntry = typeof EpisodeHistoryEntry.Type;

/** The history row a deleted recording leaves for one owner. */
export const historyEntryFor = (
  recording: EpisodeSubject,
  owner: { readonly userId: UserId; readonly ruleId?: RuleId | undefined },
  context: EpisodeContext,
): EpisodeHistoryEntry => {
  const identity = episodeIdentity(recording, context);
  return {
    userId: owner.userId,
    ...(owner.ruleId === undefined ? {} : { ruleId: owner.ruleId }),
    showKey: identity.showKey,
    class: identity._tag,
    ...(identity._tag === "Episode" && identity.season !== undefined
      ? { season: identity.season }
      : {}),
    ...(identity._tag === "Episode" && identity.episode !== undefined
      ? { episode: identity.episode }
      : {}),
    ...(identity._tag !== "Film" && identity.subtitleKey !== undefined
      ? { subtitleKey: identity.subtitleKey }
      : {}),
    ...(identity._tag === "Film" && identity.year !== undefined ? { filmYear: identity.year } : {}),
    airedAt: recording.start,
    channelId: recording.channelId,
    title: recording.title,
  };
};

const historyFacts = (entry: EpisodeHistoryEntry): EpisodeFacts => {
  const identity: EpisodeIdentity =
    entry.class === "Film"
      ? { _tag: "Film", showKey: entry.showKey, year: entry.filmYear }
      : entry.class === "Episode"
        ? {
            _tag: "Episode",
            showKey: entry.showKey,
            season: entry.season,
            episode: entry.episode,
            subtitleKey: entry.subtitleKey,
          }
        : { _tag: entry.class, showKey: entry.showKey, subtitleKey: entry.subtitleKey };
  return {
    identity,
    start: epochMs(entry.airedAt),
    lengthMs: 0,
    live: false,
    marked: false,
    sport: entry.class === "Event",
    description: "",
  };
};

/** What a left-out airing points at: the copy that counts, or the history row (§7). */
export const RepeatState = Schema.Literals([
  "completed",
  "incomplete",
  "recording",
  "scheduled",
  "history",
]);
export type RepeatState = typeof RepeatState.Type;

/** The copy of an episode that made an airing a repeat ("Already recorded Sun 22, 20:15"). */
export const RepeatRef = Schema.Struct({
  /** Absent for a history row and for an airing only planned so far. */
  recordingId: Schema.optionalKey(RecordingId),
  start: Instant,
  channelId: ChannelId,
  state: RepeatState,
}).annotate({ identifier: "RepeatRef" });
export type RepeatRef = typeof RepeatRef.Type;

/** Recordings and history rows by show key, built once per plan (§4.2). */
export interface EpisodeIndex<R extends EpisodeRecording = EpisodeRecording> {
  readonly recordings: Map<string, Array<R>>;
  readonly history: Map<string, Array<EpisodeHistoryEntry>>;
}

/** Indexes recordings and history by show key, so `findRepeat` never scans the library. */
export const episodeIndex = <R extends EpisodeRecording>(
  recordings: ReadonlyArray<R>,
  history: ReadonlyArray<EpisodeHistoryEntry>,
): EpisodeIndex<R> => {
  const index: EpisodeIndex<R> = { recordings: new Map(), history: new Map() };
  for (const recording of recordings) addToEpisodeIndex(index, recording);
  for (const entry of history) {
    index.history.set(entry.showKey, [...(index.history.get(entry.showKey) ?? []), entry]);
  }
  return index;
};

/** Adds one recording (or planned airing) to an index. */
export const addToEpisodeIndex = <R extends EpisodeRecording>(
  index: EpisodeIndex<R>,
  recording: R,
): void => {
  const key = showKey(recording.title);
  index.recordings.set(key, [...(index.recordings.get(key) ?? []), recording]);
};

/** What deciding whether an airing is a repeat for one person needs. */
export interface FindRepeatContext<
  R extends EpisodeRecording = EpisodeRecording,
> extends EpisodeContext {
  /** Whose copies and history count: the series recording's owner, or the viewer. */
  readonly ownerId: UserId;
  /** Whether that person may see a recording (`seesRecording`); everyone sees all when absent. */
  readonly sees?: ((ownerId: UserId, recording: R) => boolean) | undefined;
  /** Recordings and programmes the current conflict result cannot serve, by id. */
  readonly unserved?: ReadonlySet<string> | undefined;
}

/** States whose copy counts as having the episode, before the conditions on each (§3.6). */
const countingStates: ReadonlySet<RecordingState> = new Set([
  "completed",
  "incomplete",
  "recording",
  "scheduled",
]);

/**
 * Whether a copy counts as having the episode (§3.6): completed, incomplete without needing a
 * repeat, recording, or scheduled unless the conflict result cannot serve it. Failed,
 * cancelled, hidden and damaged copies do not count.
 */
export const countsAsHad = (
  recording: EpisodeRecording,
  unserved: ReadonlySet<string> = new Set(),
): boolean => {
  if (!countingStates.has(recording.state)) return false;
  if (recording.hiddenAt !== undefined) return false;
  if (recording.state === "scheduled") {
    return !(
      (recording.id !== undefined && unserved.has(recording.id)) ||
      (recording.programmeId !== undefined && unserved.has(recording.programmeId))
    );
  }
  return !needsRepeat(recording);
};

/**
 * The copy that makes `candidate` a repeat for one person (§3.6, §5.2): a recording they may see
 * that counts and is the same episode, else their history row of it. The earliest copy wins.
 */
export const findRepeat = <R extends EpisodeRecording>(
  candidate: EpisodeSubject,
  index: EpisodeIndex<R>,
  context: FindRepeatContext<R>,
): RepeatRef | undefined => {
  const key = showKey(candidate.title);
  const facts = factsOf(candidate, context);
  const copies = (index.recordings.get(key) ?? [])
    .filter(
      (recording) =>
        countsAsHad(recording, context.unserved) &&
        (context.sees?.(context.ownerId, recording) ?? true) &&
        sameFacts(facts, factsOf(recording, context), context.timeZone),
    )
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
  const [copy] = copies;
  if (copy !== undefined) {
    return {
      ...(copy.id === undefined ? {} : { recordingId: copy.id }),
      start: copy.start,
      channelId: copy.channelId,
      state: isPlayable(copy) ? copy.state : "scheduled",
    };
  }
  const had = (index.history.get(key) ?? []).find(
    (entry) =>
      entry.userId === context.ownerId && sameFacts(facts, historyFacts(entry), context.timeZone),
  );
  return had === undefined
    ? undefined
    : { start: had.airedAt, channelId: had.channelId, state: "history" };
};

/** A guide entry the repeat search may pick. */
export type RepeatCandidate = EpisodeSubject & { readonly id: string };

/** What finding the repeat of a damaged recording needs (§3.7). */
export interface FindRepeatAiringContext extends EpisodeContext {
  /** Whether a person may see a channel; every channel when absent. */
  readonly seesChannel?: ((ownerId: UserId, channelId: ChannelId) => boolean) | undefined;
  /**
   * Whether a person may see a recording (`seesRecording`), asked with the repeat as it would be
   * recorded, so a collection-limited owner only gets a repeat that lands where they see it.
   * Everyone sees all when absent.
   */
  readonly sees?: ((ownerId: UserId, recording: EpisodeRecording) => boolean) | undefined;
  /** Programmes the current conflict result cannot serve, by id. */
  readonly unserved?: ReadonlySet<string> | undefined;
}

/** What the repeat search reads of a damaged recording, or of a planned airing. */
export type RepeatOriginal = EpisodeSubject &
  Pick<EpisodeRecording, "ownerIds" | "programmeId"> & {
    readonly ruleId?: RuleId | undefined;
    readonly padding?: EpisodeRecording["padding"] | undefined;
    readonly rerunUntil?: Instant | undefined;
  };

/**
 * The airing that repeats a damaged recording (§3.7): the earliest programme that starts after
 * the original ended and before its `rerunUntil`, is the same episode and is one EVERY owner of
 * the original may see (its channel and, for a collection-limited profile, where the repeat
 * would land), preferring airings the conflict result can serve. The series recording's
 * conditions are ignored on purpose: a Tatort repeat on ONE and the replay "F1: Rennen - GP
 * Katar (Wh.)" fail them and are still the episode.
 */
export const findRepeatAiring = <P extends RepeatCandidate>(
  original: RepeatOriginal,
  programmes: ReadonlyArray<P>,
  context: FindRepeatAiringContext,
): P | undefined => {
  const ended = epochMs(original.end);
  const until =
    original.rerunUntil === undefined ? ended + rerunWindowMs : epochMs(original.rerunUntil);
  const facts = factsOf(original, context);
  const everyOwnerSees = (programme: P): boolean => {
    const { id: _id, ...airing } = programme;
    const asRecorded: EpisodeRecording = {
      ...airing,
      state: "scheduled",
      problems: [],
      padding: original.padding ?? noPadding,
      ownerIds: original.ownerIds,
      ruleId: original.ruleId,
    };
    return original.ownerIds.every(
      (owner) =>
        (context.seesChannel?.(owner, programme.channelId) ?? true) &&
        (context.sees?.(owner, asRecorded) ?? true),
    );
  };
  const found = programmes
    .filter((programme) => {
      const start = epochMs(programme.start);
      return (
        start >= ended &&
        start < until &&
        programme.id !== original.programmeId &&
        sameFacts(facts, factsOf(programme, context), context.timeZone) &&
        everyOwnerSees(programme)
      );
    })
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
  return found.find((programme) => !(context.unserved?.has(programme.id) ?? false)) ?? found[0];
};
