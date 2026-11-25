import { RecordingRequest, RuleInput, type ScheduleConflict } from "@slipstream/api";
import {
  CollectionId,
  HOUR,
  MINUTE,
  type Padding,
  paddingLimits,
  Programme,
  RecordOptions,
  seriesRule,
} from "@slipstream/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { conflict } from "../../tests/fixtures.ts";
import {
  recordOnceRequest,
  repeatStatus,
  sheetPlan,
  sheetProgramme,
  stepPadding,
  type SheetProgramme,
} from "./record-options.ts";

const T = Date.UTC(2026, 10, 22, 7);

/** The extra time a server with the shipped defaults answers with. */
const padding: Padding = { beforeMinutes: 2, afterMinutes: 10 };

const compact: SheetProgramme = {
  programmeId: "compact" as SheetProgramme["programmeId"],
  channelId: "f1" as SheetProgramme["channelId"],
  title: "F1: Rennen Kompakt",
  start: T + HOUR,
  end: T + 2 * HOUR,
};

const automatic = {
  automatic: true,
  newCollection: false,
  collectionIds: [],
  initial: { _tag: "Automatic" },
};

/** The F1 replay's every row, as the server works it out: every broadcast of "F1". */
const f1Every = { kind: "broadcasts", name: "F1" };

/**
 * Record options as the server sends them, decoded through the real schema. `goesTo: "none"`
 * is a profile that may not record.
 */
const options = (fields: {
  readonly status?: unknown;
  readonly goesTo?: unknown;
  readonly every?: unknown;
}) =>
  Schema.decodeUnknownSync(RecordOptions)({
    programmeId: "compact",
    extraTime: { padding, source: { _tag: "Global" } },
    ...(fields.goesTo === "none" ? {} : { goesTo: fields.goesTo ?? automatic }),
    automaticGroup: { source: "title", folders: [], item: { _tag: "Text", text: "Kompakt" } },
    status: fields.status ?? { _tag: "NotScheduled" },
    every: fields.every ?? f1Every,
  });

const recorded = (state: string, own: Padding = { beforeMinutes: 5, afterMinutes: 60 }) => ({
  _tag: "Recorded",
  recordingId: "rec",
  state,
  padding: own,
});

describe("stepPadding", () => {
  it("walks the domain's steps up to four hours and holds at the ends", () => {
    expect(stepPadding(padding, "beforeMinutes", 1)).toEqual({
      beforeMinutes: 3,
      afterMinutes: 10,
    });
    expect(stepPadding(padding, "afterMinutes", -1)).toEqual({
      beforeMinutes: 2,
      afterMinutes: 5,
    });
    expect(stepPadding({ beforeMinutes: 0, afterMinutes: 0 }, "beforeMinutes", -1)).toEqual({
      beforeMinutes: 0,
      afterMinutes: 0,
    });
    const top = { beforeMinutes: 0, afterMinutes: 180 };
    expect(stepPadding(top, "afterMinutes", 1).afterMinutes).toBe(paddingLimits.max);
    expect(stepPadding(stepPadding(top, "afterMinutes", 1), "afterMinutes", 1).afterMinutes).toBe(
      paddingLimits.max,
    );
  });

  it("moves an in-between value to the neighbouring step", () => {
    expect(
      stepPadding({ beforeMinutes: 4, afterMinutes: 0 }, "beforeMinutes", 1).beforeMinutes,
    ).toBe(5);
    expect(
      stepPadding({ beforeMinutes: 4, afterMinutes: 0 }, "beforeMinutes", -1).beforeMinutes,
    ).toBe(3);
  });
});

/** The sheet for the F1 replay, whose every row the server sends as the broadcasts kind. */
const planFor = (
  recordOptions: RecordOptions,
  programme: SheetProgramme,
  conflicts: readonly ScheduleConflict[],
  now: number,
) => sheetPlan(recordOptions, programme, conflicts, now);

describe("sheetPlan", () => {
  const before = T;

  it("offers recording, the steppers and a reminder before an unrecorded programme", () => {
    const plan = planFor(options({}), compact, [], before);
    expect(plan.state).toEqual({ kind: "record", live: false });
    expect(plan.options).toEqual(["record", "every", "extraTime", "remind"]);
    expect(plan.every).toEqual({ kind: "broadcasts", name: "F1" });
    expect(plan.padding).toEqual(padding);
    expect(plan.collectionId).toBeUndefined();
  });

  it("drops the reminder once the programme is on air", () => {
    const plan = planFor(options({}), compact, [], compact.start + MINUTE);
    expect(plan.state).toEqual({ kind: "record", live: true });
    expect(plan.options).toEqual(["record", "every", "extraTime"]);
  });

  it("hides Record and Record every from a profile without Goes-to choices", () => {
    expect(planFor(options({ goesTo: "none" }), compact, [], before).options).toEqual(["remind"]);
  });

  it("records into the profile's own collection when Goes to starts on one", () => {
    const limited = {
      automatic: false,
      newCollection: false,
      collectionIds: ["kids"],
      initial: { _tag: "Collection", collectionId: "kids" },
    };
    const plan = planFor(options({ goesTo: limited }), compact, [], before);
    expect(plan.collectionId).toBe("kids");
  });

  it("offers Skip, the recording's own extra time and a reminder when scheduled", () => {
    const plan = planFor(options({ status: recorded("scheduled") }), compact, [], before);
    expect(plan.state).toEqual({ kind: "scheduled", conflict: false });
    expect(plan.options).toEqual(["skip", "extraTime", "remind"]);
    expect(plan.recordingId).toBe("rec");
    expect(plan.padding).toEqual({ beforeMinutes: 5, afterMinutes: 60 });
  });

  it("is in conflict only when a server conflict names this recording", () => {
    const other = conflict(["darts", "nba"], compact.start, compact.end);
    const mine = conflict(["rec", "darts"], compact.start, compact.end);
    const scheduled = options({ status: recorded("scheduled") });
    // A conflict at the same time between other recordings says nothing about this one.
    expect(planFor(scheduled, compact, [other], before).conflict).toBeUndefined();
    expect(planFor(options({}), compact, [other], before).state).toEqual({
      kind: "record",
      live: false,
    });
    const plan = planFor(scheduled, compact, [other, mine], before);
    expect(plan.state).toEqual({ kind: "scheduled", conflict: true });
    expect(plan.conflict).toBe(mine);
  });

  it("offers Watch for a running or finished recording", () => {
    const running = planFor(options({ status: recorded("recording") }), compact, [], before);
    expect(running.state.kind).toBe("recording");
    expect(running.options).toEqual(["watch"]);
    const done = planFor(options({ status: recorded("completed") }), compact, [], before);
    expect(done.state.kind).toBe("recorded");
    expect(done.options).toEqual(["watch"]);
  });

  it("offers no second recording for the household, only a reminder", () => {
    const household = { _tag: "Household", adminId: "admin" };
    const plan = planFor(options({ status: household }), compact, [], before);
    expect(plan.state.kind).toBe("household");
    expect(plan.options).toEqual(["remind"]);
    expect(planFor(options({ status: household }), compact, [], compact.end).options).toEqual([]);
  });

  it("offers nothing once an unrecorded programme has ended", () => {
    const plan = planFor(options({}), compact, [], compact.end);
    expect(plan.state.kind).toBe("ended");
    expect(plan.options).toEqual([]);
  });
});

describe("requests", () => {
  it("builds a one-off recording the API accepts, with padding only when it was changed", () => {
    expect(
      Schema.encodeSync(RecordingRequest)(recordOnceRequest(compact, undefined, undefined)),
    ).toEqual({ _tag: "Programme", programmeId: "compact" });
    const changed = stepPadding(padding, "afterMinutes", 1);
    expect(
      Schema.encodeSync(RecordingRequest)(recordOnceRequest(compact, changed, undefined)),
    ).toEqual({
      _tag: "Programme",
      programmeId: "compact",
      padding: { beforeMinutes: 2, afterMinutes: 15 },
    });
  });

  it("sends the collection a limited profile records into", () => {
    const kids = CollectionId.make("kids");
    expect(
      Schema.encodeSync(RecordingRequest)(recordOnceRequest(compact, undefined, kids)),
    ).toEqual({ _tag: "Programme", programmeId: "compact", collectionId: "kids" });
    expect(Schema.encodeSync(RuleInput)(seriesRule(compact, padding, kids)).collectionId).toBe(
      "kids",
    );
  });

  it("builds the series rule on this channel the API accepts", () => {
    const rule = seriesRule(compact, padding);
    expect(Schema.encodeSync(RuleInput)(rule)).toEqual({
      name: "F1",
      enabled: true,
      matcher: {
        channels: ["f1"],
        title: [{ _tag: "StartsWith", values: ["F1:"] }],
        categories: [],
        weekdays: [],
      },
      padding: { beforeMinutes: 2, afterMinutes: 10 },
      retention: { _tag: "KeepAll" },
      skipRepeats: true,
    });
  });
});

/** A guide entry as the server sends it, decoded through the real schema. */
const guideEntry = (fields: Record<string, unknown>): Programme =>
  Schema.decodeUnknownSync(Programme)({
    id: "p",
    channelId: "ard",
    start: new Date(T + HOUR).toISOString(),
    end: new Date(T + 2 * HOUR).toISOString(),
    categories: [],
    repeat: false,
    live: false,
    ...fields,
  });

const tatort = guideEntry({
  title: "Tatort",
  subtitle: "Unter Wölfen",
  categories: ["Fernsehfilm"],
});
const race = guideEntry({
  channelId: "f1",
  title: "Live F1: Rennen - GP Katar",
  subtitle: "Großer Preis von Katar",
  categories: ["Motorsport"],
  live: true,
});

const tatortEvery = { kind: "series", name: "Tatort" };

describe("the every row", () => {
  it("names the row the way the server says: Record series for Tatort", () => {
    const plan = sheetPlan(options({ every: tatortEvery }), sheetProgramme(tatort), [], T);
    expect(plan.every).toEqual({ kind: "series", name: "Tatort" });
    expect(plan.options).toEqual(["record", "every", "extraTime", "remind"]);
  });

  it("offers Record every “Live F1” for a live race", () => {
    const every = { kind: "broadcasts", name: "Live F1" };
    const plan = sheetPlan(options({ every }), sheetProgramme(race), [], T);
    expect(plan.every).toEqual(every);
    expect(plan.options).toContain("every");
  });

  it("hides the every row for a film, and when the answer has none", () => {
    const film = sheetProgramme(guideEntry({ title: "Der Pate", categories: ["Spielfilm"] }));
    const none = sheetPlan(options({ every: { kind: "none", name: "Der Pate" } }), film, [], T);
    expect(none.every).toBeUndefined();
    expect(none.options).toEqual(["record", "extraTime", "remind"]);
  });

  it("creates a series recording that leaves out episodes the viewer already has", () => {
    const rule = Schema.encodeSync(RuleInput)(seriesRule(sheetProgramme(tatort), padding));
    expect(rule.skipRepeats).toBe(true);
    expect(rule.name).toBe("Tatort");
    expect(rule.matcher.channels).toEqual(["ard"]);
  });
});

describe("owned and repeat airings", () => {
  const before = T;
  const ref = (state: string, channelId = "one") => ({
    recordingId: "copy",
    start: new Date(T - 24 * HOUR).toISOString(),
    channelId,
    state,
  });
  const tatortSheet = sheetProgramme(tatort);

  it("keeps both record rows when the viewer merely has the episode, and says so", () => {
    const plan = sheetPlan(
      options({ status: { _tag: "Owned", of: ref("completed") } }),
      tatortSheet,
      [],
      before,
    );
    expect(plan.state.kind).toBe("owned");
    expect(plan.options).toEqual(["record", "every", "extraTime", "remind"]);
    expect(repeatStatus(plan.state, tatortSheet)).toEqual({
      kind: "recorded",
      start: new Date(T - 24 * HOUR),
      channelId: "one",
      recordingId: "copy",
    });
  });

  it("offers Record anyway in place of the record rows when a series recording left it out", () => {
    const plan = sheetPlan(
      options({ status: { _tag: "Repeat", of: ref("scheduled", "ard"), ruleId: "tatort" } }),
      tatortSheet,
      [],
      before,
    );
    expect(plan.state.kind).toBe("repeat");
    expect(plan.options).toEqual(["anyway", "extraTime", "remind"]);
    // The same channel is not named again.
    // A scheduled copy has nothing to play yet.
    expect(repeatStatus(plan.state, tatortSheet)).toEqual({
      kind: "scheduled",
      start: new Date(T - 24 * HOUR),
      channelId: undefined,
      recordingId: undefined,
    });
  });

  it("says a deleted episode was had before", () => {
    const plan = sheetPlan(
      options({ status: { _tag: "Repeat", of: ref("history"), ruleId: "tatort" } }),
      tatortSheet,
      [],
      before,
    );
    expect(repeatStatus(plan.state, tatortSheet)).toMatchObject({
      kind: "deleted",
      recordingId: undefined,
    });
  });

  it("plays a copy that is still recording, as the domain's repeatKind reads it", () => {
    const plan = sheetPlan(
      options({ status: { _tag: "Owned", of: ref("recording") } }),
      tatortSheet,
      [],
      before,
    );
    expect(repeatStatus(plan.state, tatortSheet)).toMatchObject({
      kind: "recorded",
      recordingId: "copy",
    });
  });

  it("records anyway as a one-off with no series recording behind it", () => {
    expect(
      Schema.encodeSync(RecordingRequest)(recordOnceRequest(tatortSheet, undefined, undefined)),
    ).toEqual({ _tag: "Programme", programmeId: "p" });
  });

  it("offers nothing to record to a profile without Goes-to choices", () => {
    const plan = sheetPlan(
      options({
        goesTo: "none",
        status: { _tag: "Repeat", of: ref("completed"), ruleId: "tatort" },
      }),
      tatortSheet,
      [],
      before,
    );
    expect(plan.options).toEqual(["remind"]);
  });

  it("has no status line for an airing nobody has", () => {
    const plan = sheetPlan(options({}), tatortSheet, [], before);
    expect(repeatStatus(plan.state, tatortSheet)).toBeUndefined();
  });
});
