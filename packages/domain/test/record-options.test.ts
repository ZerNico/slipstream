import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import type { Collection } from "../src/collection.ts";
import { type ExtraTimeDefaults, initialExtraTimeDefaults } from "../src/extra-time.ts";
import { fullAccess } from "../src/household.ts";
import { ChannelId, CollectionId, ProgrammeId, RecordingId, RuleId, UserId } from "../src/ids.ts";
import type { Programme } from "../src/programme.ts";
import {
  type RecordedCandidate,
  recordOptionsFor,
  recordSheetState,
  scheduleConflictFor,
} from "../src/record-options.ts";
import { isActive, type RecordingState } from "../src/recording.ts";
import { MINUTE } from "../src/time.ts";

const recorded = (state: RecordingState) => ({
  status: {
    _tag: "Recorded" as const,
    recordingId: RecordingId.make("r"),
    state,
    padding: { beforeMinutes: 0, afterMinutes: 0 },
  },
});

describe("recordSheetState", () => {
  const range = { start, end: start + 90 * MINUTE };
  const none = { status: { _tag: "NotScheduled" as const } };

  it("covers the footer table of SPEC §8.3", () => {
    const during = start + 30 * MINUTE;
    expect(recordSheetState(recorded("recording"), range, during, false)).toEqual({
      kind: "recording",
    });
    expect(recordSheetState(none, range, during, false)).toEqual({ kind: "record", live: true });
    expect(recordSheetState(none, range, start - MINUTE, false)).toEqual({
      kind: "record",
      live: false,
    });
    expect(recordSheetState(recorded("scheduled"), range, start - MINUTE, true)).toEqual({
      kind: "scheduled",
      conflict: true,
    });
    expect(recordSheetState(none, range, range.end + MINUTE, false)).toEqual({ kind: "ended" });
    expect(recordSheetState(recorded("completed"), range, range.end + MINUTE, false)).toEqual({
      kind: "recorded",
    });
    expect(recordSheetState(recorded("incomplete"), range, range.end + MINUTE, false)).toEqual({
      kind: "recorded",
    });
    expect(
      recordSheetState(
        { status: { _tag: "Household", adminId: UserId.make("a") } },
        range,
        during,
        false,
      ),
    ).toEqual({ kind: "household" });
  });

  it("offers recording again when a recording of an airing still on air failed", () => {
    expect(recordSheetState(recorded("failed"), range, start + MINUTE, false)).toEqual({
      kind: "record",
      live: true,
    });
  });
});

describe("scheduleConflictFor", () => {
  it("finds the conflict that holds the recording", () => {
    const first = { recordingIds: ["a", "b"], channelIds: [] };
    const second = { recordingIds: ["c", "d"], channelIds: [] };
    expect(scheduleConflictFor("d", [first, second])).toBe(second);
    expect(scheduleConflictFor("x", [first, second])).toBeUndefined();
    expect(scheduleConflictFor("a", [])).toBeUndefined();
  });
});

const start = Date.UTC(2026, 10, 22, 17, 0);
const skyF1 = ChannelId.make("sky-sport-f1");

const programme = (title: string, extra: Partial<Programme> = {}): Programme => ({
  id: ProgrammeId.make(`p-${title}`),
  channelId: skyF1,
  start: DateTime.makeUnsafe(start),
  end: DateTime.makeUnsafe(start + 90 * MINUTE),
  title,
  categories: ["Sport"],
  repeat: false,
  live: true,
  ...extra,
});

/** SPEC §7.7's defaults: Sport 5/60, Sky Sport F1 5/60 (here 5/45, to tell them apart), Film 2/15. */
const defaults: ExtraTimeDefaults = {
  padding: { beforeMinutes: 2, afterMinutes: 10 },
  overrides: [
    { _tag: "Category", category: "Sport", padding: { beforeMinutes: 5, afterMinutes: 60 } },
    { _tag: "Channel", channelId: skyF1, padding: { beforeMinutes: 5, afterMinutes: 45 } },
    { _tag: "Category", category: "film", padding: { beforeMinutes: 2, afterMinutes: 15 } },
  ],
};

const formel1: Collection = {
  id: CollectionId.make("formel-1"),
  name: "Formel 1",
  rank: 1,
  matcher: {
    channels: [skyF1],
    title: [{ _tag: "StartsWith", values: ["Live F1:"] }],
    categories: [],
    weekdays: [],
  },
  labels: [],
  layout: { parts: [], path: [] },
};
const kids: Collection = {
  ...formel1,
  id: CollectionId.make("kids"),
  name: "Kids",
  rank: 0,
  matcher: {
    ...formel1.matcher,
    title: [{ _tag: "StartsWith", values: ["Die Sendung mit der Maus"] }],
  },
};

/** Before the programmes start: nothing has ended yet. */
const before = start - 60 * MINUTE;

const context = (
  title: string,
  extra: Partial<Parameters<typeof recordOptionsFor<RecordedCandidate>>[0]> = {},
) => ({
  programme: programme(title),
  channelName: "Sky Sport F1 HD",
  recordings: [] as readonly RecordedCandidate[],
  now: before,
  collections: [formel1, kids],
  access: fullAccess,
  mayCreateCollections: true,
  extraTime: defaults,
  timeZone: "Europe/Berlin",
  episodes: { timeZone: "Europe/Berlin", channelName: () => "Sky Sport F1 HD" },
  ...extra,
});

/** A recording of `p` in `state`, as the library lists it. */
const recordingOf = (
  p: Programme,
  id: string,
  state: RecordedCandidate["state"],
): RecordedCandidate => ({
  id: RecordingId.make(id),
  programmeId: p.id,
  channelId: p.channelId,
  title: p.title,
  start: p.start,
  end: p.end,
  state,
  padding: { beforeMinutes: 5, afterMinutes: 60 },
  ownerIds: [UserId.make("jonas")],
});

describe("recordOptionsFor", () => {
  it("names the channel default when a channel override exists: channel beats category", () => {
    const options = recordOptionsFor(context("Live F1: Qualifying - GP Katar"));
    expect(options.extraTime).toEqual({
      padding: { beforeMinutes: 5, afterMinutes: 45 },
      source: { _tag: "Channel", channelId: skyF1 },
    });
  });

  it("falls back to the category, then the global default", () => {
    const onArte = {
      ...programme("Der Pate", { categories: ["Film"] }),
      channelId: ChannelId.make("arte"),
    };
    expect(recordOptionsFor({ ...context("x"), programme: onArte }).extraTime.source).toEqual({
      _tag: "Category",
      category: "film",
    });
    expect(
      recordOptionsFor({ ...context("x"), extraTime: initialExtraTimeDefaults }).extraTime,
    ).toEqual({ padding: { beforeMinutes: 2, afterMinutes: 10 }, source: { _tag: "Global" } });
  });

  it("puts Automatic where the matching collection takes it", () => {
    const options = recordOptionsFor(context("Live F1: Rennen - GP Katar"));
    expect(options.automaticGroup.collectionId).toBe(formel1.id);
    expect(options.goesTo).toMatchObject({ automatic: true, newCollection: true });
    expect(options.goesTo?.collectionIds).toEqual([kids.id, formel1.id]);
  });

  it("offers a collection-limited profile only its own collections, starting on the first", () => {
    const options = recordOptionsFor(
      context("Sendung mit der Maus", {
        access: { mayRecord: true, collectionIds: [kids.id] },
        mayCreateCollections: false,
      }),
    );
    expect(options.goesTo).toEqual({
      automatic: false,
      newCollection: false,
      collectionIds: [kids.id],
      initial: { _tag: "Collection", collectionId: kids.id },
    });
    expect(recordOptionsFor(context("x", { access: { mayRecord: false } })).goesTo).toBeUndefined();
  });

  it("reports the caller's recording of the programme, never a failed one", () => {
    const p = programme("Live F1: Rennen");
    const entry = { ...recordingOf(p, "r1", "scheduled"), ruleId: RuleId.make("f1") };
    const options = recordOptionsFor({ ...context("x"), programme: p, recordings: [entry] });
    expect(options.status).toEqual({
      _tag: "Recorded",
      recordingId: entry.id,
      state: "scheduled",
      padding: entry.padding,
      ruleId: entry.ruleId,
    });
    const failed = recordingOf(p, "f", "failed");
    expect(
      recordOptionsFor({ ...context("x"), programme: p, recordings: [failed] }).status,
    ).toEqual({ _tag: "NotScheduled" });
  });

  it("prefers the running recording over a finished one", () => {
    const p = programme("x");
    const status = recordOptionsFor({
      ...context("x"),
      programme: p,
      recordings: [recordingOf(p, "a", "completed"), recordingOf(p, "b", "recording")],
    }).status;
    expect(status).toMatchObject({ _tag: "Recorded", recordingId: "b" });
  });

  it("lets a programme still on air be recorded again after its capture ended", () => {
    const p = programme("Live F1: Rennen");
    const cut = recordingOf(p, "cut", "incomplete");
    const onAir = start + 30 * MINUTE;
    expect(
      recordOptionsFor({ ...context("x"), programme: p, recordings: [cut], now: onAir }).status,
    ).toEqual({ _tag: "NotScheduled" });
    const later = start + 120 * MINUTE;
    expect(
      recordOptionsFor({ ...context("x"), programme: p, recordings: [cut], now: later }).status,
    ).toMatchObject({ _tag: "Recorded", recordingId: "cut", state: "incomplete" });
    expect(
      ["scheduled", "recording", "completed", "incomplete", "failed"].map((state) =>
        isActive({ state: state as RecordedCandidate["state"] }),
      ),
    ).toEqual([true, true, false, false, false]);
  });

  it("answers Household when the caller may not see where it goes", () => {
    const p = programme("Live F1: Rennen");
    const status = recordOptionsFor({
      ...context("x"),
      programme: p,
      recordings: [recordingOf(p, "r", "scheduled")],
      sees: () => false,
      householdAdminId: UserId.make("admin"),
    }).status;
    expect(status).toEqual({ _tag: "Household", adminId: "admin" });
  });
});

describe("an episode the caller already has (§3.1)", () => {
  const of = {
    recordingId: RecordingId.make("sunday"),
    start: DateTime.makeUnsafe(start - 2 * 24 * 60 * MINUTE),
    channelId: ChannelId.make("one"),
    state: "completed" as const,
  };
  const series = RuleId.make("tatort");

  it("is Owned when no series recording of the caller decided, Repeat when one left it out", () => {
    expect(recordOptionsFor({ ...context("Tatort"), repeat: { of } }).status).toEqual({
      _tag: "Owned",
      of,
    });
    expect(
      recordOptionsFor({ ...context("Tatort"), repeat: { of, ruleId: series } }).status,
    ).toEqual({ _tag: "Repeat", of, ruleId: series });
  });

  it("lets a recording of this very airing win over the episode", () => {
    const p = programme("Tatort");
    const entry = recordingOf(p, "this-airing", "scheduled");
    const status = recordOptionsFor({
      ...context("Tatort"),
      programme: p,
      recordings: [entry],
      repeat: { of, ruleId: series },
    }).status;
    expect(status._tag).toBe("Recorded");
  });

  it("gives the sheet the owned and repeat kinds, live or not, and nothing once ended", () => {
    const range = { start, end: start + 90 * MINUTE };
    const owned = { status: { _tag: "Owned" as const, of } };
    const repeat = { status: { _tag: "Repeat" as const, of, ruleId: series } };
    expect(recordSheetState(owned, range, start - MINUTE, false)).toEqual({
      kind: "owned",
      live: false,
      of,
    });
    expect(recordSheetState(repeat, range, start + MINUTE, false)).toEqual({
      kind: "repeat",
      live: true,
      of,
      ruleId: series,
    });
    expect(recordSheetState(repeat, range, range.end + MINUTE, false)).toEqual({ kind: "ended" });
  });
});

describe("recordOptionsFor every", () => {
  it("offers every broadcast of an event, named without the trailing colon", () => {
    expect(recordOptionsFor(context("Live F1: Rennen - GP Katar")).every).toEqual({
      kind: "broadcasts",
      name: "Live F1",
    });
  });

  it("offers a series for an episode and nothing for a film", () => {
    const tatort = programme("Tatort", {
      subtitle: "Borowski und der Schatten des Mondes",
      categories: ["Krimi"],
      live: false,
    });
    expect(recordOptionsFor({ ...context("x"), programme: tatort }).every).toEqual({
      kind: "series",
      name: "Tatort",
    });
    const film = programme("Der Pate", { categories: ["Film"], live: false });
    expect(recordOptionsFor({ ...context("x"), programme: film }).every).toEqual({
      kind: "none",
      name: "Der Pate",
    });
  });

  it("falls back to the time zone and channel name without an episode context", () => {
    // A sub-title that only repeats the channel name identifies nothing: every broadcast.
    const magazine = programme("Boxengasse", {
      subtitle: "Sky Sport F1 HD",
      categories: ["Magazin"],
      live: false,
    });
    expect(recordOptionsFor({ ...context("x"), programme: magazine }).every.kind).toBe(
      "broadcasts",
    );
  });

  it("reads the episode context when given", () => {
    const krimi = programme("Polizeiruf 110", { categories: ["Krimi"], live: false });
    expect(recordOptionsFor({ ...context("x"), programme: krimi }).every.kind).toBe("broadcasts");
    const episodes = { timeZone: "Europe/Berlin", filmCategories: ["Krimi"] };
    expect(recordOptionsFor({ ...context("x"), programme: krimi, episodes }).every.kind).toBe(
      "none",
    );
  });

  it("passes the server's repeat airing through", () => {
    const later = programme("Live F1: Rennen - GP Katar (Wdh.)");
    const repeatAiring = {
      programmeId: later.id,
      channelId: later.channelId,
      start: later.start,
      end: later.end,
    };
    expect(recordOptionsFor({ ...context("x"), repeatAiring }).repeatAiring).toEqual(repeatAiring);
    expect(recordOptionsFor(context("x"))).not.toHaveProperty("repeatAiring");
  });
});
