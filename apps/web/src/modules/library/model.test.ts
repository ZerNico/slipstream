import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import { isPlayable, MINUTE, RecordingId, resolveOptions, scheduledDays } from "@slipstream/domain";
import { makeMockData, mockTimeZone } from "~/api/mock/fixtures.ts";
import { exportFact, opensChoice, primaryAction } from "./detail.ts";
import {
  draftFromCollection,
  draftFromGroup,
  draftToInput,
  emptyDraft,
  markTitle,
  previewDraft,
} from "./editor.ts";
import { groupKeyOf, groupPage, libraryGroups, slug } from "./groups.ts";
import { recordedSpan, type Entry } from "./library.ts";
import { dayOf } from "~/modules/guide/model.ts";
import { dayPill, pathLabels } from "@slipstream/i18n";

const NOW = Date.UTC(2026, 10, 22, 5, 12);
const utc = (...parts: [number, number, number, number, number]) =>
  DateTime.makeUnsafe(Date.UTC(...parts));
const data = makeMockData(NOW);
const labels = pathLabels();

const byId = (id: string): Entry => {
  const entry = data.recordings.find((item) => item.id === id);
  if (!entry) throw new Error(`no fixture recording ${id}`);
  return entry;
};

describe("library groups", () => {
  it("keys collections by id and automatic groups by the slug of their top folder", () => {
    expect(groupKeyOf(byId("weekend-1"), labels)).toBe("formel-1");
    expect(groupKeyOf(byId("der-pate"), labels)).toBe("films");
    expect(slug("Terra X: Faszination Erde")).toBe("terra-x-faszination-erde");
    expect(slug("Ärger über Öl")).toBe("arger-uber-ol");
  });

  it("puts collections first and counts running and new recordings in the tile", () => {
    const groups = libraryGroups(data.recordings.filter(isPlayable), data.collections, labels);
    expect(groups[0]?.key).toBe("formel-1");
    expect(groups[0]?.source).toBe("collection");
    const f1 = groups[0];
    expect(f1?.entries.some((entry) => entry.state === "recording")).toBe(true);
    expect(f1?.newCount).toBe(f1?.entries.filter((e) => e.state === "completed").length);
    expect(groups.find((group) => group.key === "films")?.source).toBe("film");
  });

  it("builds a collection page with a season and event sections, scheduled sessions as ghosts", () => {
    const page = groupPage("formel-1", data.recordings, data.collections, labels, undefined);
    expect(page?.seasons).toEqual(["2026"]);
    expect(page?.season).toBe("2026");
    const vegas = page?.sections.find((section) => section.title === "GP Las Vegas");
    expect(vegas?.recording).toBe(true);
    expect(vegas?.entries.map((entry) => entry.id)).toContain("rennen-las-vegas");
    const katar = page?.sections.find((section) => section.title === "GP Katar");
    expect(katar?.entries).toHaveLength(0);
    expect(katar?.scheduled.length).toBeGreaterThan(0);
    // Newest event first: the weekend still to come, then this weekend.
    expect(page?.sections[0]?.title).toBe("GP Katar");
  });

  it("answers undefined for a group that doesn't exist", () => {
    expect(groupPage("nope", data.recordings, data.collections, labels, undefined)).toBeUndefined();
  });
});

describe("scheduled", () => {
  it("groups scheduled recordings by day and flags every item of an overlap", () => {
    const days = scheduledDays(data.recordings, data.conflicts, data.sources, mockTimeZone);
    const rows = days.flatMap((day) => day.rows);
    expect(rows.every((row) => row.entry.state === "scheduled")).toBe(true);
    const darts = rows.find((row) => row.entry.id === "darts-finale");
    expect(darts?.conflict).toBe(true);
    expect(darts?.resolution?.room).toEqual({ kind: "free", streams: 1 });
    expect(rows.filter((row) => row.resolution !== undefined)).toHaveLength(1);
    const starts = days.map((day) => day.day);
    expect(starts).toEqual(starts.toSorted((a, b) => a - b));
  });

  it("names days in the household's zone, the same days the guide shows", () => {
    // Auckland is 11 to 13 hours from any zone a test machine is likely in, so a day counted in
    // the process's zone would split differently.
    const zone = "Pacific/Auckland";
    const late = {
      ...byId("darts-finale"),
      id: RecordingId.make("late"),
      start: utc(2026, 10, 22, 10, 30),
    };
    const early = { ...late, id: RecordingId.make("early"), start: utc(2026, 10, 22, 11, 30) };
    const days = scheduledDays([late, early], [], [], zone);
    expect(days.map((day) => day.rows.map((row) => row.entry.id))).toEqual([["late"], ["early"]]);
    for (const day of days) {
      const first = day.rows[0]?.entry;
      if (first === undefined) throw new Error("empty day");
      const guide = dayOf(DateTime.toEpochMillis(first.start), NOW, zone);
      expect(day.day).toBe(guide.start);
      expect(dayPill(day.day, NOW, zone)).toMatch(new RegExp(` ${guide.date}$`, "u"));
    }
    // NOW is 18:12 on Sunday 22 in Auckland.
    expect(dayPill(DateTime.toEpochMillis(late.start), NOW, zone)).toBe("Today 22");
    expect(dayPill(DateTime.toEpochMillis(early.start), NOW, zone)).toBe("Mon 23");
    expect(dayPill(DateTime.toEpochMillis(late.start), NOW, undefined)).toBe("");
  });

  it("offers skipping first, and shortening only where extra time is all that overlaps", () => {
    const conflict = data.conflicts[0];
    if (!conflict) throw new Error("no fixture conflict");
    const options = resolveOptions(conflict, data.recordings);
    expect(options.map((option) => [option.kind, option.entry.id])).toEqual([
      ["skip", "darts-finale"],
      ["shorten", "rennen-las-vegas"],
    ]);
    const shorten = options[1];
    expect(shorten?.kind === "shorten" && shorten.keepsAfter).toBe(2);
  });
});

describe("recording detail", () => {
  const race = byId("rennen-las-vegas");

  it("opens the choice for a running recording, with the wall clock when there is a position", () => {
    expect(primaryAction(race)).toEqual({ kind: "watch" });
    const resumed = { ...race, positionMillis: 11 * MINUTE };
    expect(primaryAction(resumed)).toEqual({
      kind: "resumeAt",
      at: recordedSpan(race).start + 11 * MINUTE,
    });
    expect(opensChoice(primaryAction(resumed))).toBe(true);
  });

  it("plays an untouched finished recording directly and resumes a started one by position", () => {
    const quali = byId("weekend-4");
    expect(primaryAction(quali)).toEqual({ kind: "play" });
    expect(opensChoice(primaryAction(quali))).toBe(false);
    expect(primaryAction({ ...quali, positionMillis: 46 * MINUTE })).toEqual({
      kind: "resumeFrom",
      position: 46 * MINUTE,
    });
    expect(primaryAction(byId("tagesschau-failed"))).toEqual({ kind: "none" });
  });

  it("states the planned export path", () => {
    expect(exportFact({ ...race, exportPath: "/media/tv/Formel 1/x.mkv" })).toEqual({
      kind: "planned",
      path: "/media/tv/Formel 1/x.mkv",
    });
    expect(exportFact({ ...byId("weekend-1"), exportPath: "/a.mkv" }).kind).toBe("done");
    expect(exportFact(byId("tagesschau-failed")).kind).toBe("nothingCaptured");
    expect(exportFact(byId("weekend-1")).kind).toBe("off");
  });
});

describe("collection editor draft", () => {
  const context = { timeZone: mockTimeZone };
  const ruleCollection = (entry: Entry) =>
    data.rules.find((rule) => rule.id === entry.ruleId)?.collectionId;
  const library = data.recordings.filter((entry) => entry.state !== "scheduled");

  it("round-trips a collection, keeping its parts, rank and retention", () => {
    const f1 = data.collections[0];
    if (!f1) throw new Error("no fixture collection");
    const draft = draftFromCollection(f1);
    expect(draft.path).toEqual(["year", "event", "programme"]);
    expect(draft.keep).toBe("events3");
    const input = draftToInput(draft);
    expect(input.layout.parts).toEqual(f1.layout.parts);
    expect(input.layout.path).toEqual(f1.layout.path);
    expect(input.retention).toEqual(f1.retention);
    expect(input.matcher.title).toEqual(f1.matcher.title);
  });

  it("adds the event and programme split parts when the layout asks for them", () => {
    const input = draftToInput({
      ...emptyDraft,
      name: "Darts",
      startsWith: ["Darts:"],
      path: ["event", "programme"],
    });
    expect(input.layout.parts.map((part) => part.name)).toEqual(["event", "programme"]);
    expect(input.matcher.title).toEqual([{ _tag: "StartsWith", values: ["Darts:"] }]);
    expect(input.retention).toBeUndefined();
  });

  it("previews with the real precedence: what lands, the tree, and the example", () => {
    const preview = previewDraft(
      { ...emptyDraft, name: "Snooker", startsWith: ["Snooker"], path: ["title"] },
      library,
      data.collections,
      ruleCollection,
      context,
      labels,
    );
    const snooker = library.filter((entry) => entry.title.startsWith("Snooker"));
    expect(preview.placed).toBe(snooker.length);
    expect(preview.tree[0]?.name).toBe("Snooker");
    expect(preview.example?.path[0]).toBe("Snooker");
    expect(preview.overlaps).toEqual([]);
  });

  it("reports what another collection keeps instead of placing it twice", () => {
    const preview = previewDraft(
      { ...emptyDraft, name: "Rennen", startsWith: ["Live F1:"], path: ["title"] },
      library,
      data.collections,
      ruleCollection,
      context,
      labels,
    );
    // The F1 rule records into Formel 1, which wins over a new title match.
    expect(preview.elsewhere.length).toBeGreaterThan(0);
    expect(preview.elsewhere[0]?.collection).toBe("Formel 1");
    expect(preview.overlaps[0]?.name).toBe("Formel 1");
  });

  it("previews nothing until the draft has a name and something that belongs in it", () => {
    const empty = previewDraft(
      emptyDraft,
      library,
      data.collections,
      ruleCollection,
      context,
      labels,
    );
    expect(empty.placed).toBe(0);
    expect(empty.example).toBeUndefined();
  });

  it("starts from an automatic group with its name, channel and title start", () => {
    const groups = libraryGroups(library.filter(isPlayable), data.collections, labels);
    const films = groups.find((group) => group.key === "films");
    if (!films) throw new Error("no films group");
    const draft = draftFromGroup(films);
    expect(draft.name).toBe(films.name);
    expect(draft.startsWith).toEqual([]);
    expect(draft.categories.length).toBe(1);
    expect(draft.channels).toHaveLength(1);
  });

  it("marks the parts of the example title in their tones", () => {
    expect(
      markTitle("Live F1: Qualifying - GP Katar", [
        { text: "GP Katar", tone: 1 },
        { text: "Qualifying", tone: 2 },
      ]),
    ).toEqual([
      { text: "Live F1: ", tone: 0 },
      { text: "Qualifying", tone: 2 },
      { text: " - ", tone: 0 },
      { text: "GP Katar", tone: 1 },
    ]);
  });
});

describe("fixture sanity", () => {
  it("has the running recording the detail tests rely on", () => {
    expect(byId("rennen-las-vegas").state).toBe("recording");
    expect(RecordingId.make("x")).toBe("x");
    expect(DateTime.toEpochMillis(byId("rennen-las-vegas").start)).toBeLessThan(NOW);
  });
});
