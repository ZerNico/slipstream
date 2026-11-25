import { HOUR, type Padding, RecordingId, type RecordingState } from "@slipstream/domain";
import { DateTime } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conflictText } from "./conflict-text.ts";
import {
  conflictTitle,
  dayPill,
  recordingFacts,
  rerunText,
  sentenceDay,
  whenLabel,
} from "./recording-text.ts";
import { setLocale, setRegion, setTimeZone } from "./runtime.ts";

const berlin = "Europe/Berlin";

// The household's zone differs from this process's, so nothing passes by counting in the wrong one.
const processZone = process.env["TZ"];
beforeAll(() => {
  process.env["TZ"] = "UTC";
});
// Clock times are written in the zone the clients set, the household's.
beforeEach(() => setTimeZone(berlin));
afterAll(() => {
  if (processZone === undefined) delete process.env["TZ"];
  else process.env["TZ"] = processZone;
});
afterEach(() => {
  setLocale("en");
  setRegion(undefined);
  setTimeZone(undefined);
});

describe("days", () => {
  // Sunday 22 November 2026, 13:00 in Berlin.
  const now = Date.UTC(2026, 10, 22, 12);

  it("writes a day pill as Today or the weekday with the date, and nothing without a zone", () => {
    expect(dayPill(now, now, berlin)).toBe("Today 22");
    expect(dayPill(now + 24 * HOUR, now, berlin)).toBe("Mon 23");
    expect(dayPill(now, now, undefined)).toBe("");
    setLocale("de");
    expect(dayPill(now + 24 * HOUR, now, berlin)).toBe("Mo 23");
  });

  it("writes a relative day in lower case inside a sentence", () => {
    expect(sentenceDay(now, now, berlin)).toBe("today 22");
    expect(sentenceDay(now + 24 * HOUR, now, berlin)).toBe("Mon 23");
  });

  it("labels a start as today, tomorrow or the day pill with the time", () => {
    setRegion("DE");
    expect(whenLabel(Date.UTC(2026, 10, 22, 18, 25), now, berlin)).toBe("Today 19:25");
    expect(whenLabel(Date.UTC(2026, 10, 23, 16), now, berlin)).toBe("Tomorrow 17:00");
    expect(whenLabel(Date.UTC(2026, 10, 28, 16), now, berlin)).toBe("Sat 28 17:00");
  });

  it("counts days in the household's zone, whatever zone the device is in", () => {
    // 01:00 on Monday 23 in Auckland, still Sunday 22 in UTC and in Europe.
    const auckland = "Pacific/Auckland";
    expect(whenLabel(Date.UTC(2026, 10, 22, 13), now, auckland)).toMatch(/^Today /u);
    expect(whenLabel(Date.UTC(2026, 10, 23, 11, 30), now, auckland)).toMatch(/^Tomorrow /u);
    expect(whenLabel(Date.UTC(2026, 10, 22, 10, 30), now, auckland)).toMatch(/^Sun 22 /u);
    // 21:00 on Monday in Berlin; 00:30 on Tuesday there is still Monday in UTC.
    const evening = Date.UTC(2026, 10, 23, 20);
    const late = Date.UTC(2026, 10, 23, 23, 30);
    expect(whenLabel(late, evening, berlin)).toMatch(/^Tomorrow /u);
    expect(conflictTitle(late, evening, berlin)).toMatch(/^Conflict tomorrow at /u);
    expect(whenLabel(late, evening, "America/New_York")).toMatch(/^Today /u);
  });

  it("compares calendar dates across the DST changes", () => {
    // 00:30 on Sunday 25 October 2026 in Berlin, before the clocks go back; Monday 20:15 is
    // tomorrow although more than 24 h away.
    const autumn = Date.UTC(2026, 9, 24, 22, 30);
    expect(whenLabel(Date.UTC(2026, 9, 26, 19, 15), autumn, berlin)).toMatch(/^Tomorrow /u);
    expect(conflictTitle(Date.UTC(2026, 9, 26, 19, 15), autumn, berlin)).toMatch(
      /^Conflict tomorrow at /u,
    );
    expect(whenLabel(Date.UTC(2026, 9, 25, 22), autumn, berlin)).toMatch(/^Today /u);
    // 23:30 on Saturday 27 March 2027; the clocks go forward that night.
    const spring = Date.UTC(2027, 2, 27, 22, 30);
    expect(whenLabel(Date.UTC(2027, 2, 28, 18, 15), spring, berlin)).toMatch(/^Tomorrow /u);
    setLocale("de");
    expect(whenLabel(Date.UTC(2027, 2, 28, 18, 15), spring, berlin)).toMatch(/^Morgen /u);
  });
});

describe("recording facts", () => {
  // Sun 22 Nov 2026, 21:00 in Berlin.
  const now = Date.UTC(2026, 10, 22, 20);
  const padding: Padding = { beforeMinutes: 0, afterMinutes: 0 };
  const subject = (state: RecordingState, from: number, to: number) => ({
    state,
    start: DateTime.makeUnsafe(from),
    end: DateTime.makeUnsafe(to),
    padding,
    sizeBytes: 4_200_000_000,
  });

  it("reads channel · when · length · size", () => {
    setRegion("GB");
    const finished = subject("completed", now - 3 * HOUR, now - 1.5 * HOUR);
    expect(recordingFacts(finished, now, berlin, "Das Erste")).toMatch(
      /^Das Erste · Today 22 · 18:00–19:30 · 1\sh\s30\smin · 4\.2\sGB$/u,
    );
  });

  it("says how much a running recording has so far and leaves the size out when scheduled", () => {
    setRegion("DE");
    expect(recordingFacts(subject("recording", now - HOUR, now + HOUR), now, berlin)).toMatch(
      /so far 1\sh of 2\sh/u,
    );
    expect(recordingFacts(subject("scheduled", now + HOUR, now + 2 * HOUR), now, berlin)).toMatch(
      /^Today 22 · 22:00–23:00 · 1\sh$/u,
    );
  });
});

describe("repeat search", () => {
  const now = Date.UTC(2026, 10, 22, 20);
  const id = RecordingId.make("damaged");

  it("says until when it looks, that none was found, or why both copies stay", () => {
    const until = DateTime.makeUnsafe(now + 2 * 24 * HOUR);
    expect(
      rerunText({ id, protected: false, rerun: { state: "looking", until } }, now, berlin),
    ).toBe("Looking for a repeat until Tue 24");
    expect(rerunText({ id, protected: false, rerun: { state: "exhausted" } }, now, berlin)).toBe(
      "No repeat found",
    );
    expect(rerunText({ id, protected: true, rerun: { state: "kept" } }, now, berlin)).toBe(
      "Kept because it is protected",
    );
    expect(rerunText({ id, protected: false }, now, berlin)).toBeUndefined();
  });
});

describe("conflict sentence", () => {
  it("phrases the room the server reports", () => {
    setRegion("GB");
    const words = {
      count: 3,
      from: Date.UTC(2026, 10, 22, 19, 15),
      to: Date.UTC(2026, 10, 22, 21),
      titles: ["Tatort", "Terra X", "Rennen"],
    };
    expect(conflictText({ ...words, room: { kind: "limit", streams: 2 } })).toMatch(
      /^3 recordings overlap .*, but only 2 can record at once: Tatort, Terra X and Rennen\.$/u,
    );
    expect(conflictText({ ...words, room: { kind: "free", streams: 0 } })).toMatch(
      /but no stream is free then/u,
    );
    expect(conflictText({ ...words, room: { kind: "unknown" } })).toMatch(
      /and not all of them can record/u,
    );
  });
});
