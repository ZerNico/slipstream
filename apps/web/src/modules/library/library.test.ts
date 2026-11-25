import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import { isNew, isPlayable, isProblemRecording, MINUTE, UserId } from "@slipstream/domain";
import { makeMockData } from "~/api/mock/fixtures.ts";
import { upcomingWindow } from "./conflicts.ts";
import {
  filterRecordings,
  gapsOf,
  groupRecordings,
  itemName,
  missingMillis,
  recordedSpan,
  recordingTimeline,
  resumeMillis,
  type Entry,
  type LibraryContext,
} from "./library.ts";
import { pathLabels } from "@slipstream/i18n";

const NOW = Date.UTC(2026, 10, 22, 5, 12);
const data = makeMockData(NOW);
const context: LibraryContext = {
  labels: pathLabels(),
  channels: data.channels,
  collections: data.collections,
  day: (epochMs) => new Date(epochMs).toISOString().slice(0, 10),
  timeZone: "UTC",
};

const byId = (id: string): Entry => {
  const entry = data.recordings.find((item) => item.id === id);
  if (!entry) throw new Error(`no fixture recording ${id}`);
  return entry;
};

const library = data.recordings.filter(isPlayable);

describe("filterRecordings", () => {
  const all = { filter: "all", query: "", user: UserId.make("alex"), context } as const;

  it("keeps everything by default", () => {
    expect(filterRecordings(library, all)).toHaveLength(library.length);
  });

  it("hides what the reader finished for Unwatched", () => {
    const marked = library.map((entry) =>
      entry.id === "weekend-1" ? { ...entry, watched: true } : entry,
    );
    const unwatched = filterRecordings(marked, { ...all, filter: "unwatched" });
    expect(unwatched).toHaveLength(library.length - 1);
    expect(unwatched.some((entry) => entry.id === "weekend-1")).toBe(false);
  });

  it("keeps only the caller's recordings for Mine", () => {
    const mine = filterRecordings(library, { ...all, user: UserId.make("kim"), filter: "mine" });
    expect(mine.map((entry) => entry.id)).toEqual(["der-pate", "tatort-unter-woelfen"]);
  });

  it("matches every word, in any order, across title, channel and group path", () => {
    const shown = filterRecordings(library, { ...all, query: "vegas training 3." });
    expect(shown.map((entry) => entry.id)).toEqual(["weekend-3"]);
    expect(filterRecordings(library, { ...all, query: "formel arte" })).toHaveLength(0);
    expect(filterRecordings(library, { ...all, query: "SKY sport f1" }).length).toBeGreaterThan(4);
  });
});

describe("groupRecordings", () => {
  it("groups by the collection path and names items by their last part", () => {
    const groups = groupRecordings(library, "collections", context);
    const vegas = groups.find((group) => group.title === "GP Las Vegas");
    expect(vegas?.crumbs).toEqual(["Formel 1", "2026"]);
    expect(vegas?.collection).toBe("Formel 1");
    expect(vegas?.items.map((entry) => itemName(entry, context.labels))).toEqual([
      "1. Freies Training",
      "2. Freies Training",
      "3. Freies Training",
      "Qualifying",
      "Pressekonferenz Qualifying",
      "Rennen",
    ]);
  });

  it("puts collections before guide-data groups, films under Films", () => {
    const groups = groupRecordings(library, "collections", context);
    expect(groups[0]?.collection).toBe("Formel 1");
    const films = groups.findIndex((group) => group.title === "Films");
    expect(films).toBeGreaterThan(0);
    expect(groups[films]?.items.map((entry) => entry.id)).toEqual(["der-pate"]);
    expect(itemName(byId("der-pate"), context.labels)).toBe("Der Pate (1972)");
  });

  it("sums sizes per group", () => {
    const vegas = groupRecordings(library, "collections", context).find(
      (group) => group.title === "GP Las Vegas",
    );
    expect(vegas?.sizeBytes).toBeCloseTo((7 + 7 + 6.1 + 7 + 1.9 + 3.5) * 1e9);
  });

  it("orders channels by number and days newest first", () => {
    expect(groupRecordings(library, "channel", context).map((group) => group.title)).toEqual([
      "Sky Sport F1",
      "Das Erste",
      "arte",
      "Eurosport 1",
    ]);
    const days = groupRecordings(library, "date", context).map((group) => group.title);
    expect(days).toEqual(days.toSorted().toReversed());
  });

  it("counts By date days in the household's zone, not the browser's", () => {
    // 23:30 and 00:30 in Auckland are one UTC day apart from what Auckland calls them.
    const late = {
      ...library[0],
      start: DateTime.makeUnsafe(Date.UTC(2026, 10, 21, 10, 30)),
    } as Entry;
    const early = {
      ...library[0],
      id: "early",
      start: DateTime.makeUnsafe(Date.UTC(2026, 10, 21, 11, 30)),
    } as Entry;
    const keys = (timeZone: string) =>
      groupRecordings([late, early], "date", { ...context, timeZone }).map(
        (group) => group.items.length,
      );
    expect(keys("UTC")).toEqual([2]);
    expect(keys("Pacific/Auckland")).toEqual([1, 1]);
  });
});

describe("recording state", () => {
  it("sends failed recordings to Problems, not the library", () => {
    expect(isProblemRecording(byId("tagesschau-failed"))).toBe(true);
    expect(isPlayable(byId("tagesschau-failed"))).toBe(false);
  });

  it("draws a running recording with padding, ticks, gap and live edge", () => {
    const race = byId("rennen-las-vegas");
    const span = recordedSpan(race);
    const timeline = recordingTimeline(race, NOW, 10 * MINUTE);
    expect(timeline.start).toBe(span.start);
    expect(span.end - span.start).toBe((120 + 5 + 60) * MINUTE);
    expect(timeline.live).toBe(NOW);
    expect(timeline.captured).toEqual({ start: span.start, end: NOW });
    expect(timeline.gaps).toHaveLength(1);
    expect(timeline.playhead).toBe(span.start + 10 * MINUTE);
  });

  it("reads resume positions", () => {
    const quali = { ...byId("weekend-4"), positionMillis: 61 * MINUTE };
    expect(resumeMillis(quali)).toBe(61 * MINUTE);
    expect(resumeMillis({ ...quali, watched: true })).toBeUndefined();
    expect(resumeMillis(byId("weekend-1"))).toBeUndefined();
  });

  it("marks finished recordings nobody started as new", () => {
    const quali = byId("weekend-4");
    expect(isNew(quali)).toBe(true);
    expect(isNew({ ...quali, positionMillis: MINUTE })).toBe(false);
    expect(isNew({ ...quali, watched: true })).toBe(false);
    expect(isNew(byId("rennen-las-vegas"))).toBe(false);
  });
});

describe("scheduled and missing time", () => {
  it("looks at the next 15 days from the start of the hour", () => {
    const window = upcomingWindow(NOW);
    expect(window.from).toBe(Date.UTC(2026, 10, 22, 5));
    expect(window.to - window.from).toBe(15 * 24 * 60 * MINUTE);
  });

  it("counts the time the source dropped out, up to now", () => {
    const race = byId("rennen-las-vegas");
    expect(missingMillis(race, NOW)).toBeGreaterThan(0);
    expect(missingMillis(byId("presse-qualifying"), NOW)).toBe(0);
  });

  it("reads gaps as the domain's summary does: every ranged cause, merged, up to now", () => {
    const race = byId("rennen-las-vegas");
    const start = recordedSpan(race).start;
    const at = (minutes: number) => DateTime.makeUnsafe(start + minutes * MINUTE);
    const entry: Entry = {
      ...race,
      state: "incomplete",
      problems: [
        { _tag: "Gap", range: { start: at(10), end: at(20) } },
        { _tag: "SourceLimitReached", range: { start: at(15), end: at(30) } },
      ],
    };
    expect(gapsOf(entry, NOW)).toEqual([{ start: start + 10 * MINUTE, end: start + 30 * MINUTE }]);
    expect(missingMillis(entry, NOW)).toBe(20 * MINUTE);
    const running: Entry = { ...entry, state: "recording" };
    expect(missingMillis(running, start + 25 * MINUTE)).toBe(15 * MINUTE);
  });
});
