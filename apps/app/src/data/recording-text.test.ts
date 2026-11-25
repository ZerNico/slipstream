import { HOUR, MINUTE, UserId } from "@slipstream/domain";
import { setLocale, setRegion, setTimeZone } from "@slipstream/i18n";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conflict, recording } from "../../tests/fixtures.ts";
import { conflictWords, problemLine, todoItems } from "./recording-text.ts";

// Sun 22 Nov 2026, 20:00 UTC.
const T = Date.UTC(2026, 10, 22, 20);

beforeAll(() => {
  setLocale("en");
  setRegion("GB");
  setTimeZone("UTC");
});
afterAll(() => {
  setRegion(undefined);
  setTimeZone(undefined);
});

const finished = recording({
  id: "tatort",
  channelId: "ard",
  title: "Tatort",
  start: T - 3 * HOUR,
  end: T - HOUR - 30 * MINUTE,
  state: "completed",
  sizeBytes: 4_200_000_000,
});

describe("conflictWords", () => {
  it("names the recordings in the conflict and the server's capacity", () => {
    const darts = recording({
      id: "darts",
      channelId: "sport1",
      start: T,
      end: T + HOUR,
      title: "Darts",
    });
    const nba = recording({ id: "nba", channelId: "dazn", start: T, end: T + HOUR, title: "NBA" });
    const busy = { ...conflict(["darts", "nba", "gone"], T, T + HOUR), capacity: 1 };
    expect(conflictWords(busy, [darts, nba])).toEqual({
      count: 3,
      from: T,
      to: T + HOUR,
      room: { kind: "limit", streams: 1 },
      titles: ["Darts", "NBA"],
    });
  });
});

describe("problemLine", () => {
  it("is nothing for a good recording", () => {
    expect(problemLine(finished, [finished], T)).toBeUndefined();
  });

  it("says what is missing and where the repeat stands", () => {
    const damaged = recording({
      id: "damaged",
      channelId: "ard",
      start: T - 3 * HOUR,
      end: T - 2 * HOUR,
      state: "incomplete",
      gaps: [[T - 3 * HOUR, T - 3 * HOUR + 2 * MINUTE]],
      rerun: { state: "looking", until: new Date(T + 2 * 24 * HOUR).toISOString() },
    });
    expect(problemLine(damaged, [damaged], T)).toEqual({
      failed: false,
      text: expect.stringMatching(/^2\smin missing · Looking for a repeat until Tue 24$/u),
    });
  });

  it("reads a recording with nothing captured as failed", () => {
    const failed = recording({
      id: "failed",
      channelId: "ard",
      start: T - 3 * HOUR,
      end: T - 2 * HOUR,
      state: "failed",
      noData: true,
    });
    expect(problemLine(failed, [failed], T)).toEqual({ failed: true, text: "Recording failed" });
  });
});

describe("todoItems", () => {
  const me = UserId.make("u1");
  const failed = recording({
    id: "failed",
    channelId: "ard",
    title: "Tagesschau",
    start: T - 5 * HOUR,
    end: T - 4 * HOUR,
    state: "failed",
    noData: true,
  });
  const incomplete = recording({
    id: "incomplete",
    channelId: "ard",
    title: "Tatort",
    start: T - 3 * HOUR,
    end: T - 2 * HOUR,
    state: "incomplete",
    gaps: [[T - 3 * HOUR, T - 3 * HOUR + 5 * MINUTE]],
  });
  const theirs = recording({
    id: "theirs",
    channelId: "ard",
    start: T - 2 * HOUR,
    end: T - HOUR,
    state: "failed",
    noData: true,
    ownerIds: ["u2"],
  });
  const clash = conflict(["a", "b"], T + HOUR, T + 2 * HOUR);

  it("lists this profile's problems, failed first, and no conflicts for a member", () => {
    const items = todoItems({
      me,
      admin: false,
      recordings: [incomplete, failed, theirs, finished],
      conflicts: [clash],
      now: T,
    });
    expect(items.map((item) => item.title)).toEqual(["Tagesschau failed", "Tatort is incomplete"]);
  });

  it("adds everyone's problems and the conflicts for an admin", () => {
    const items = todoItems({
      me,
      admin: true,
      recordings: [incomplete, failed, theirs],
      conflicts: [clash],
      now: T,
    });
    expect(items.map((item) => item.kind)).toEqual([
      "recording",
      "recording",
      "recording",
      "conflict",
    ]);
    expect(items.at(-1)?.title).toBe("Conflict today at 21:00");
  });

  it("shows a damaged recording and its damaged repeat as one card", () => {
    const repeat = recording({
      id: "repeat",
      channelId: "ard",
      start: T - HOUR,
      end: T,
      state: "incomplete",
      gaps: [[T - HOUR, T - HOUR + MINUTE]],
      replaces: "incomplete",
    });
    const items = todoItems({
      me,
      admin: false,
      recordings: [incomplete, repeat],
      conflicts: [],
      now: T,
    });
    expect(items.map((item) => item.id)).toEqual(["recording:incomplete"]);
  });
});
