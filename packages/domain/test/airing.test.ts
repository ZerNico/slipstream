import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ProgrammeId, RecordingId, UserId } from "../src/ids.ts";
import { canEditRule, isPin, pinLength } from "../src/household.ts";
import {
  type RecordingProblem,
  recordingGapSummary,
  type RecordingState,
} from "../src/recording.ts";
import { recordingsOfAiring } from "../src/airing.ts";
import {
  extendedEnd,
  extendPadding,
  extendStepMinutes,
  noPadding,
  paddingLimits,
} from "../src/time.ts";
import { arte, at, daserste, programme } from "./test-support.ts";

const tatort = programme({
  channelId: daserste,
  title: "Tatort",
  start: at("2026-11-22T19:15:00Z"),
  end: at("2026-11-22T20:45:00Z"),
});

const recording = (
  id: string,
  state: RecordingState,
  fields: Partial<{
    programmeId: ProgrammeId;
    channelId: typeof daserste;
    title: string;
    start: string;
    end: string;
  }> = {},
) => ({
  id: RecordingId.make(id),
  state,
  channelId: fields.channelId ?? daserste,
  title: fields.title ?? tatort.title,
  start: fields.start === undefined ? tatort.start : at(fields.start),
  end: fields.end === undefined ? tatort.end : at(fields.end),
  ...(fields.programmeId === undefined ? {} : { programmeId: fields.programmeId }),
});

describe("recordingsOfAiring", () => {
  it("takes the same guide entry, and the same title when the guide id changed", () => {
    const own = recording("own", "scheduled", { programmeId: tatort.id });
    const renamed = recording("renamed", "completed", { programmeId: ProgrammeId.make("old") });
    expect(recordingsOfAiring(tatort, [own, renamed]).map((found) => found.id)).toEqual([
      "own",
      "renamed",
    ]);
  });

  it("counts a manual recording on the channel that covers the whole programme", () => {
    const covers = recording("covers", "recording", {
      title: "Das Erste",
      start: "2026-11-22T19:00:00Z",
      end: "2026-11-22T21:00:00Z",
    });
    const partial = recording("partial", "recording", {
      title: "Das Erste",
      start: "2026-11-22T19:30:00Z",
      end: "2026-11-22T21:00:00Z",
    });
    const elsewhere = recording("elsewhere", "recording", {
      title: "Arte",
      channelId: arte,
      start: "2026-11-22T19:00:00Z",
      end: "2026-11-22T21:00:00Z",
    });
    expect(
      recordingsOfAiring(tatort, [covers, partial, elsewhere]).map((found) => found.id),
    ).toEqual(["covers"]);
  });

  it("leaves out failed and cancelled recordings", () => {
    const recordings = (["failed", "cancelled", "incomplete"] as const).map((state) =>
      recording(state, state, { programmeId: tatort.id }),
    );
    expect(recordingsOfAiring(tatort, recordings).map((found) => found.id)).toEqual(["incomplete"]);
  });

  it("leaves out another title at the same time", () => {
    const other = recording("other", "scheduled", {
      programmeId: ProgrammeId.make("news"),
      title: "Tagesschau",
    });
    expect(recordingsOfAiring(tatort, [other])).toEqual([]);
  });
});

/** A range on the evening of 22 November, from clock times ("19:30"). */
const range = (from: string, to: string) => ({
  start: at(`2026-11-22T${from}:00Z`),
  end: at(`2026-11-22T${to}:00Z`),
});

describe("recordingGapSummary", () => {
  const window = {
    start: at("2026-11-22T19:15:00Z"),
    end: at("2026-11-22T20:45:00Z"),
    padding: { beforeMinutes: 5, afterMinutes: 10 },
  };
  const summary = (state: RecordingState, problems: readonly RecordingProblem[]) =>
    recordingGapSummary({ ...window, state, problems });

  it("merges ranged problems in the padded window and names the dominant cause", () => {
    const result = summary("incomplete", [
      { _tag: "Gap", range: range("19:30", "19:35") },
      { _tag: "SourceUnreachable", range: range("19:33", "19:40"), retries: 2 },
      { _tag: "SourceUnreachable", range: range("19:34", "19:36"), retries: 5 },
      { _tag: "SourceLimitReached", range: range("20:00", "20:02") },
      { _tag: "Gap", range: range("20:40", "21:30") },
    ]);
    expect(result.failed).toBe(false);
    expect(result.gaps).toEqual([
      { range: range("19:30", "19:40"), cause: "SourceUnreachable", retries: 5 },
      { range: range("20:00", "20:02"), cause: "SourceLimitReached", retries: 0 },
      // Clipped to the padded end (20:45 + 10 min).
      { range: range("20:40", "20:55"), cause: "Gap", retries: 0 },
    ]);
    expect(result.missingMs).toBe((10 + 2 + 15) * 60_000);
  });

  it("reads as failed when the state failed, gaps cover the window, or no data and no gap", () => {
    expect(summary("failed", []).failed).toBe(true);
    expect(summary("incomplete", [{ _tag: "Gap", range: range("19:00", "21:00") }]).failed).toBe(
      true,
    );
    expect(summary("incomplete", [{ _tag: "NoData" }]).failed).toBe(true);
    expect(
      summary("incomplete", [{ _tag: "NoData" }, { _tag: "Gap", range: range("19:30", "19:35") }])
        .failed,
    ).toBe(false);
    expect(summary("completed", [])).toEqual({ failed: false, gaps: [], missingMs: 0 });
  });
});

describe("canEditRule", () => {
  const owner = UserId.make("alice");
  const rule = { ownerId: owner };

  it("lets admins and the owner edit, nobody else", () => {
    expect(canEditRule(rule, { id: owner, isAdmin: false })).toBe(true);
    expect(canEditRule(rule, { id: UserId.make("bob"), isAdmin: true })).toBe(true);
    expect(canEditRule(rule, { id: UserId.make("bob"), isAdmin: false })).toBe(false);
    expect(canEditRule(rule, { id: undefined, isAdmin: false })).toBe(false);
  });
});

describe("isPin", () => {
  it("accepts exactly pinLength digits", () => {
    expect(pinLength).toBe(4);
    expect(isPin("0420")).toBe(true);
    expect(isPin("042")).toBe(false);
    expect(isPin("04200")).toBe(false);
    expect(isPin("04a0")).toBe(false);
  });
});

describe("extendPadding", () => {
  it("adds one step after the end and keeps the time before", () => {
    expect(extendPadding({ beforeMinutes: 5, afterMinutes: 10 })).toEqual({
      beforeMinutes: 5,
      afterMinutes: 10 + extendStepMinutes,
    });
    expect(extendPadding(noPadding).afterMinutes).toBe(30);
  });

  it("tells when an extended recording ends: its padded end plus what Extend added", () => {
    const slot = {
      start: DateTime.makeUnsafe("2026-11-25T20:15:00Z"),
      end: DateTime.makeUnsafe("2026-11-25T21:45:00Z"),
    };
    expect(extendedEnd(slot, { beforeMinutes: 5, afterMinutes: 10 })).toBe(
      Date.parse("2026-11-25T22:25:00Z"),
    );
    // At the maximum, Extend adds nothing.
    expect(extendedEnd(slot, { beforeMinutes: 0, afterMinutes: paddingLimits.max })).toBe(
      Date.parse("2026-11-25T21:45:00Z") + paddingLimits.max * 60_000,
    );
  });

  it("holds at the stepper maximum", () => {
    expect(extendPadding({ beforeMinutes: 0, afterMinutes: 225 }).afterMinutes).toBe(
      paddingLimits.max,
    );
    expect(extendPadding({ beforeMinutes: 0, afterMinutes: paddingLimits.max }).afterMinutes).toBe(
      paddingLimits.max,
    );
  });
});
