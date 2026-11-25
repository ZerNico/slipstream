import { channelKey, type MatchReason, qualityRank, type StreamQuality } from "./channel-match.ts";

/*
 * The stream picker every client shows after a big playlist was read (web dialog, setup step,
 * phone page): which playlist groups start ticked, what is listed for a search, how a group's
 * box reads, and how many channels "Add" makes. Words are in @slipstream/i18n.
 */

/** A stream as the picker sees it: the shape of the API's catalogue entry it needs. */
export interface PickerStream {
  readonly id: string;
  readonly name: string;
  readonly group?: string | undefined;
  readonly quality: StreamQuality;
  readonly hasGuide: boolean;
  /** The channel it is added to. */
  readonly channel?: { readonly id: string; readonly name: string } | undefined;
  /** For a stream not added: the existing channel it looks like. */
  readonly match?:
    | { readonly channelId: string; readonly name: string; readonly reason: MatchReason }
    | undefined;
  readonly ignored: boolean;
  /** First seen since the source was last reviewed, and neither added nor ignored. */
  readonly new?: boolean | undefined;
}

/** A playlist group as the picker sees it (the API's group counts). */
export interface PickerGroup {
  readonly name?: string | undefined;
  readonly streams: number;
  readonly guideCoverage: number;
  readonly added: number;
  readonly ignored: number;
}

/**
 * Whether a source still has streams to choose from: neither added nor set aside. A new big
 * playlist opens the picker even when a few of its streams already joined channels by guide id.
 */
export const hasStreamsToPick = (groups: ReadonlyArray<PickerGroup>): boolean =>
  groups.some((group) => group.streams - group.added - group.ignored > 0);

/** The key the picker keeps a group under: its title, `""` for streams without one. */
export const pickerGroupKey = (group: string | undefined): string => group ?? "";

/** Whether a stream can still be picked: not a channel's yet. */
export const isPickable = (stream: PickerStream): boolean => stream.channel === undefined;

/** Whether adding this stream joins an existing channel instead of making one. */
export const joinsExisting = (stream: PickerStream): boolean =>
  stream.channel === undefined && stream.match?.reason === "sameGuide";

/** Country codes and words a playlist group of a language is named with, per UI language. */
const languageMarkers: Readonly<
  Record<string, { readonly codes: ReadonlyArray<string>; readonly words: ReadonlyArray<string> }>
> = {
  de: { codes: ["DE", "GER", "DEU"], words: ["deutsch", "german"] },
  en: {
    codes: ["UK", "GB", "US", "USA", "EN", "ENG"],
    words: ["english", "united kingdom", "britain"],
  },
};

/** Groups that are never live TV channels worth ticking for anyone: on demand, radio, adult. */
const neverTicked =
  /(?:^|[^\p{L}\p{N}])(?:vod|on[\s-]?demand|radio|adult|xxx|18\+|porn)(?=$|[^\p{L}\p{N}])/iu;

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Whether a playlist group is one of `language` (`de`, `en`): its title carries the language's
 * country code as a word in capitals ("DE | Sport", "DE: Kinder", "[DE] Doku", "Sport DE") or
 * names it ("Deutschland", "German"). On-demand, radio and adult groups never match; neither does
 * a language without markers.
 */
export const isLanguageGroup = (group: string, language: string): boolean => {
  const markers = languageMarkers[language.toLowerCase().slice(0, 2)];
  if (markers === undefined || neverTicked.test(group)) return false;
  const code = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${markers.codes.map(escape).join("|")})(?=$|[^\\p{L}\\p{N}])`,
    "u",
  );
  if (code.test(group)) return true;
  const folded = group.toLowerCase();
  return markers.words.some((word) => folded.includes(word));
};

/**
 * The streams ticked when the picker opens. A source someone has already reviewed starts with
 * nothing ticked (the admin is adding to it); a fresh one (never reviewed, even when a few of its
 * streams joined channels by guide id on their own) ticks every pickable, not ignored stream of
 * the groups in the reader's language, and nothing when none match.
 */
export const defaultPicked = (
  streams: ReadonlyArray<PickerStream>,
  language: string,
  fresh: boolean,
): Set<string> => {
  if (!fresh) return new Set();
  const matching = new Map<string, boolean>();
  const picked = new Set<string>();
  for (const stream of streams) {
    if (!isPickable(stream) || stream.ignored || stream.group === undefined) continue;
    let yes = matching.get(stream.group);
    if (yes === undefined) {
      yes = isLanguageGroup(stream.group, language);
      matching.set(stream.group, yes);
    }
    if (yes) picked.add(stream.id);
  }
  return picked;
};

/** What pressing Add does with the picked streams. */
export interface AddPlan {
  /** New channels: copies of one channel (HD, FHD, SD) become one. */
  readonly channels: number;
  /** Streams that join an existing channel with the same guide id. */
  readonly joining: number;
}

/**
 * The channel key of every stream, worked out once per list: copies of a channel share it, a
 * stream whose name says nothing keeps its own.
 */
export const pickerKeys = (streams: ReadonlyArray<PickerStream>): ReadonlyMap<string, string> =>
  new Map(streams.map((stream) => [stream.id, channelKey(stream.name) ?? `#${stream.id}`]));

/**
 * What adding the picked streams makes, as the server adds them: copies of one channel become
 * one channel, and a set of copies of which one has an existing channel's guide id joins that
 * channel instead.
 */
export const addPlan = (
  streams: ReadonlyArray<PickerStream>,
  picked: ReadonlySet<string>,
  keys: ReadonlyMap<string, string>,
): AddPlan => {
  const sets = new Map<string, { size: number; joins: boolean }>();
  for (const stream of streams) {
    if (!picked.has(stream.id) || !isPickable(stream)) continue;
    const key = keys.get(stream.id) ?? `#${stream.id}`;
    const set = sets.get(key) ?? { size: 0, joins: false };
    set.size += 1;
    set.joins ||= joinsExisting(stream);
    sets.set(key, set);
  }
  let channels = 0;
  let joining = 0;
  for (const set of sets.values()) {
    if (set.joins) joining += set.size;
    else channels += 1;
  }
  return { channels, joining };
};

/** The ids of the picked streams to send, in list order, already added ones left out. */
export const pickedIds = <S extends PickerStream>(
  streams: ReadonlyArray<S>,
  picked: ReadonlySet<string>,
): Array<S["id"]> =>
  streams.filter((stream) => picked.has(stream.id) && isPickable(stream)).map(({ id }) => id);

/** A tick box's state over several streams. */
export type TickState = "on" | "off" | "some";

/** How a group's box reads: every pickable stream ticked, none, or some. */
export const tickState = (
  streams: ReadonlyArray<PickerStream>,
  picked: ReadonlySet<string>,
): TickState => {
  let on = 0;
  let total = 0;
  for (const stream of streams) {
    if (!isPickable(stream)) continue;
    total += 1;
    if (picked.has(stream.id)) on += 1;
  }
  if (total === 0 || on === 0) return "off";
  return on === total ? "on" : "some";
};

/** `picked` with the pickable ones of `streams` ticked (`on`) or unticked. */
export const setPicked = (
  picked: ReadonlySet<string>,
  streams: ReadonlyArray<PickerStream>,
  on: boolean,
): Set<string> => {
  const next = new Set(picked);
  for (const stream of streams) {
    if (!isPickable(stream)) continue;
    if (on) next.add(stream.id);
    else next.delete(stream.id);
  }
  return next;
};

/** The qualities a group offers, best first ("FHD + HD + SD"); unknown ones say nothing. */
export const groupQualities = (streams: ReadonlyArray<PickerStream>): Array<StreamQuality> =>
  [...new Set(streams.map((stream) => stream.quality))]
    .filter((quality) => quality !== "unknown")
    .toSorted((a, b) => qualityRank(b) - qualityRank(a));

/**
 * What the list shows: every stream, only the ticked ones, or (`onlyNew`) only the streams new
 * since the source was last reviewed, narrowed by a search.
 */
export interface PickerView {
  readonly search: string;
  readonly onlyPicked: boolean;
  readonly onlyNew?: boolean;
}

/** One row of the picker's list: a group's head, or one of its streams. */
export type PickerRow<G extends PickerGroup = PickerGroup, S extends PickerStream = PickerStream> =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly group: G;
      /** The group's streams the view shows (while they load: none). */
      readonly streams: ReadonlyArray<S>;
      readonly open: boolean;
    }
  | { readonly kind: "stream"; readonly key: string; readonly stream: S };

/**
 * The picker's rows. Without a search, every group with its open ones' streams; with a search
 * or "Selected", only groups that have shown streams, all of them open. Groups come in the
 * order of `groups` (the API's); streams that have not loaded yet leave a group closed.
 */
export const pickerRows = <G extends PickerGroup, S extends PickerStream>(
  groups: ReadonlyArray<G>,
  streams: ReadonlyArray<S>,
  picked: ReadonlySet<string>,
  open: ReadonlySet<string>,
  view: PickerView,
): Array<PickerRow<G, S>> => {
  const term = view.search.trim().toLowerCase();
  const narrowed = term !== "" || view.onlyPicked || view.onlyNew === true;
  const byGroup = new Map<string, Array<S>>();
  for (const stream of streams) {
    if (term !== "" && !stream.name.toLowerCase().includes(term)) continue;
    if (view.onlyPicked && !picked.has(stream.id)) continue;
    if (view.onlyNew === true && stream.new !== true) continue;
    const key = pickerGroupKey(stream.group);
    const list = byGroup.get(key);
    if (list === undefined) byGroup.set(key, [stream]);
    else list.push(stream);
  }
  const rows: Array<PickerRow<G, S>> = [];
  for (const group of groups) {
    const key = pickerGroupKey(group.name);
    const shown = byGroup.get(key) ?? [];
    if (narrowed && shown.length === 0) continue;
    const isOpen = narrowed || open.has(key);
    rows.push({ kind: "group", key: `g:${key}`, group, streams: shown, open: isOpen });
    if (!isOpen) continue;
    for (const stream of shown) rows.push({ kind: "stream", key: stream.id, stream });
  }
  return rows;
};

/** The streams the rows show, for Select all and Select none. */
export const shownStreams = <S extends PickerStream>(
  rows: ReadonlyArray<PickerRow<PickerGroup, S>>,
): Array<S> => rows.flatMap((row) => (row.kind === "group" ? row.streams : []));
