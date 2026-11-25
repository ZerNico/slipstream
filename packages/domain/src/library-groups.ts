import type { DateTime } from "effect";
import type { Collection } from "./collection.ts";
import {
  type GroupPath,
  type GroupSource,
  type PathLabels,
  renderPath,
  renderSegment,
} from "./grouping.ts";
import { isPlayable, isRecorded, type RecordingState } from "./recording.ts";
import { epochMs } from "./time.ts";

/*
 * The library's places (SPEC §7.5), shared by web and phone: collections people made, and
 * automatic groups for everything else (guide series data, title and date, films). Tiles and
 * group pages count from the same function, running recordings included (SPEC §7.9).
 */

/** What the library reads from a recording as the API lists it (`RecordingEntry`). */
export interface ShelvedRecording {
  readonly group: GroupPath;
  readonly start: DateTime.Utc;
  readonly state: RecordingState;
  /** Whether the viewer finished it. */
  readonly watched: boolean;
  /** The viewer's resume position from the recorded start. */
  readonly positionMillis: number;
}

/** Finished or part-finished, and the viewer has not started it: the library marks it "New". */
export const isNew = (entry: ShelvedRecording): boolean =>
  isRecorded(entry) && !entry.watched && entry.positionMillis <= 0;

/** Lower case, letters and digits joined by dashes: "Terra X: Faszination" is "terra-x-faszination". */
export const slug = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

/**
 * The URL key of the place a recording appears in: the collection's id, or the slug of the
 * automatic group's top folder ("tatort", "films").
 */
export const groupKeyOf = (entry: ShelvedRecording, labels: PathLabels): string => {
  if (entry.group.collectionId !== undefined) return entry.group.collectionId;
  const top = entry.group.folders[0] ?? entry.group.item;
  return slug(renderSegment(top, labels)) || "other";
};

/** A place in the library: a collection or an automatic group, with what it holds. */
export interface LibraryGroup<E extends ShelvedRecording = ShelvedRecording> {
  readonly key: string;
  readonly name: string;
  /** Where it comes from: a collection, guide series data, title and date, or the film category. */
  readonly source: GroupSource;
  readonly collection: Collection | undefined;
  /** Its recordings, newest first, running ones included. */
  readonly entries: readonly E[];
  readonly newCount: number;
}

/** Every place the given recordings sit in: collections first (by rank), then shows by name. */
export const libraryGroups = <E extends ShelvedRecording>(
  entries: readonly E[],
  collections: readonly Collection[],
  labels: PathLabels,
): readonly LibraryGroup<E>[] => {
  const byKey = new Map<string, { entries: E[]; first: E }>();
  for (const entry of entries) {
    const key = groupKeyOf(entry, labels);
    const found = byKey.get(key);
    if (found) found.entries.push(entry);
    else byKey.set(key, { entries: [entry], first: entry });
  }
  const groups = [...byKey.entries()].map(([key, { entries: items, first }]): LibraryGroup<E> => {
    const collection = collections.find((c) => c.id === first.group.collectionId);
    const top = first.group.folders[0] ?? first.group.item;
    return {
      key,
      name: collection?.name ?? renderSegment(top, labels),
      source: collection ? "collection" : first.group.source,
      collection,
      entries: items.toSorted((a, b) => epochMs(b.start) - epochMs(a.start)),
      newCount: items.filter(isNew).length,
    };
  });
  const rank = (group: LibraryGroup<E>) => group.collection?.rank ?? Number.MAX_SAFE_INTEGER;
  return groups.toSorted(
    (a, b) =>
      Number(a.collection === undefined) - Number(b.collection === undefined) ||
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name),
  );
};

const latest = (items: readonly ShelvedRecording[]) =>
  Math.max(...items.map((entry) => epochMs(entry.start)));

/** One section of a group page: an event ("GP Katar") or a season, with its sessions. */
export interface GroupSection<E extends ShelvedRecording = ShelvedRecording> {
  readonly key: string;
  readonly title: string;
  /** Oldest first, the order a weekend happens in. */
  readonly entries: readonly E[];
  /** Scheduled recordings that will land here ("Rennen · Scheduled · Tomorrow 17:00"). */
  readonly scheduled: readonly E[];
  readonly recording: boolean;
  readonly incomplete: number;
}

/** What a group page shows: its seasons (when the layout has them) and the sections of one. */
export interface GroupPageModel<E extends ShelvedRecording = ShelvedRecording> {
  readonly group: LibraryGroup<E>;
  /** Seasons or years, newest first; empty when the layout has no such level. */
  readonly seasons: readonly string[];
  readonly season: string | undefined;
  /** Sections when the layout has a level below the season; otherwise one flat list. */
  readonly sections: readonly GroupSection<E>[];
  readonly flat: readonly E[];
}

const folderText = (
  entry: ShelvedRecording,
  index: number,
  labels: PathLabels,
): string | undefined => renderPath(entry.group, labels).slice(0, -1)[index];

/**
 * Builds a group page from every recording (library and scheduled). Paths three folders deep
 * ("Formel 1 › 2026 › GP Katar") get a season control and event sections; two deep ("Tatort ›
 * Season 3") get sections; one deep is a flat list.
 */
export const groupPage = <E extends ShelvedRecording>(
  key: string,
  all: readonly E[],
  collections: readonly Collection[],
  labels: PathLabels,
  wantedSeason: string | undefined,
): GroupPageModel<E> | undefined => {
  const mine = all.filter((entry) => groupKeyOf(entry, labels) === key);
  const library = mine.filter(isPlayable);
  const group = libraryGroups(library.length > 0 ? library : mine, collections, labels)[0];
  if (group === undefined) return undefined;
  const scheduled = mine.filter((entry) => entry.state === "scheduled");
  const libraryGroup = {
    ...group,
    entries: library.toSorted((a, b) => epochMs(b.start) - epochMs(a.start)),
  };
  const depth = Math.max(0, ...mine.map((entry) => entry.group.folders.length));
  if (depth <= 1) {
    return {
      group: libraryGroup,
      seasons: [],
      season: undefined,
      sections: [],
      flat: libraryGroup.entries,
    };
  }
  const deep = depth >= 3;
  const seasons = deep
    ? [...new Set(mine.flatMap((entry) => folderText(entry, 1, labels) ?? []))].toSorted((a, b) =>
        b.localeCompare(a, undefined, { numeric: true }),
      )
    : [];
  const season = deep ? (seasons.find((s) => s === wantedSeason) ?? seasons[0]) : undefined;
  const level = deep ? 2 : 1;
  const inSeason = (entry: E) => !deep || folderText(entry, 1, labels) === season;
  const sections = new Map<string, { entries: E[]; scheduled: E[] }>();
  const sectionOf = (entry: E) => {
    const title = folderText(entry, level, labels) ?? "";
    const section = sections.get(title) ?? { entries: [], scheduled: [] };
    sections.set(title, section);
    return section;
  };
  for (const entry of library.filter(inSeason)) sectionOf(entry).entries.push(entry);
  for (const entry of scheduled.filter(inSeason)) sectionOf(entry).scheduled.push(entry);
  return {
    group: libraryGroup,
    seasons,
    season,
    flat: [],
    sections: [...sections.entries()]
      .map(([title, section]) => ({
        key: title,
        title,
        entries: section.entries.toSorted((a, b) => epochMs(a.start) - epochMs(b.start)),
        scheduled: section.scheduled.toSorted((a, b) => epochMs(a.start) - epochMs(b.start)),
        recording: section.entries.some((entry) => entry.state === "recording"),
        incomplete: section.entries.filter((entry) => entry.state === "incomplete").length,
      }))
      .toSorted(
        (a, b) => latest([...b.entries, ...b.scheduled]) - latest([...a.entries, ...a.scheduled]),
      ),
  };
};
