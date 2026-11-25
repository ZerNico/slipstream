import { describe, expect, it } from "vitest";
import { RecordingId, SourceId } from "../src/ids.ts";
import type { RecordingState } from "../src/recording.ts";
import {
  conflictRoom,
  resolveOptions,
  scheduledDays,
  type ScheduledEntry,
  type ScheduleOverlap,
  shortenedPadding,
} from "../src/scheduled.ts";
import { at, timeZone } from "./test-support.ts";

const tvproxy = SourceId.make("tvproxy");

const entry = (
  id: string,
  start: string,
  end: string,
  afterMinutes = 0,
  state: RecordingState = "scheduled",
): ScheduledEntry => ({
  id: RecordingId.make(id),
  state,
  start: at(start),
  end: at(end),
  padding: { beforeMinutes: 0, afterMinutes },
});

const overlap = (
  ids: readonly string[],
  start: string,
  end: string,
  capacity: number,
): ScheduleOverlap => ({
  range: { start: at(start), end: at(end) },
  recordingIds: ids.map((id) => RecordingId.make(id)),
  sourceIds: [tvproxy],
  capacity,
});

// A race running into its 30 extra minutes, and two programmes starting while it does.
const race = entry("race", "2026-11-22T17:00:00Z", "2026-11-22T19:00:00Z", 30, "recording");
const darts = entry("darts", "2026-11-22T19:15:00Z", "2026-11-22T21:00:00Z");
const nba = entry("nba", "2026-11-22T19:20:00Z", "2026-11-22T21:30:00Z");
const tomorrow = entry("news", "2026-11-23T19:00:00Z", "2026-11-23T19:15:00Z");
const clash = overlap(["race", "darts", "nba"], "2026-11-22T19:20:00Z", "2026-11-22T19:30:00Z", 2);

describe("conflictRoom", () => {
  it("states free streams below the limit, the limit, or no number", () => {
    const sources = [{ id: tvproxy, maxStreams: 4 }];
    expect(conflictRoom({ ...clash, capacity: 1 }, sources)).toEqual({ kind: "free", streams: 1 });
    expect(conflictRoom({ ...clash, capacity: 3 }, sources)).toEqual({ kind: "unknown" });
    expect(conflictRoom(clash, [{ id: tvproxy, maxStreams: 2 }])).toEqual({
      kind: "limit",
      streams: 2,
    });
    // Without the sources' limits (a profile that may not read them) it says the count as is.
    expect(conflictRoom(clash, [])).toEqual({ kind: "limit", streams: 2 });
  });
});

describe("resolveOptions", () => {
  it("offers skipping first, and shortening only where extra time is all that overlaps", () => {
    const options = resolveOptions(clash, [nba, race, darts]);
    expect(options.map((option) => [option.kind, option.entry.id])).toEqual([
      ["skip", "darts"],
      ["skip", "nba"],
      ["shorten", "race"],
    ]);
    const shorten = options[2];
    if (shorten?.kind !== "shorten") throw new Error("no shorten option");
    expect(shorten.keepsAfter).toBe(20);
    expect(shorten.ofAfter).toBe(30);
    expect(shorten.endAt).toBe(Date.parse("2026-11-22T19:20:00Z"));
    expect(shortenedPadding(shorten)).toEqual({ beforeMinutes: 0, afterMinutes: 20 });
  });
});

describe("scheduledDays", () => {
  it("groups by household day in start order, flags every item, resolves under the last", () => {
    const days = scheduledDays([tomorrow, nba, race, darts], [clash], [], timeZone);
    expect(days.map((day) => day.rows.map((row) => row.entry.id))).toEqual([
      ["darts", "nba"],
      ["news"],
    ]);
    const [first, second] = days;
    expect(first?.rows.map((row) => row.conflict)).toEqual([true, true]);
    expect(first?.rows[0]?.resolution).toBeUndefined();
    expect(first?.rows[1]?.resolution).toMatchObject({
      count: 3,
      from: Date.parse("2026-11-22T19:20:00Z"),
      to: Date.parse("2026-11-22T19:30:00Z"),
    });
    expect(second?.rows[0]?.conflict).toBe(false);
    expect(first?.day).toBe(Date.parse("2026-11-21T23:00:00Z"));
    expect(first?.midday).toBe(Date.parse("2026-11-22T11:00:00Z"));
  });
});
