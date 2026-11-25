import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { RecordingId } from "../src/ids.ts";
import { HOUR, MINUTE } from "../src/time.ts";
import { type ChoiceRecording, watchChoice, watchChoiceFor } from "../src/watch-choice.ts";

const MIN = 60_000;
/** Qualifying: window 17:55 to 20:30, now 18:42. */
const at = (hours: number, minutes: number) => Date.UTC(2026, 10, 22, hours, minutes);
const window = { windowStart: at(17, 55), windowEnd: at(20, 30) };

describe("watchChoice (SPEC §7.6)", () => {
  it("offers Resume, From start and Live for a running recording you started", () => {
    const choice = watchChoice({ ...window, live: true, now: at(18, 42), resumeAt: at(18, 11) });
    expect(choice.direct).toBe(false);
    expect(choice.options).toEqual([
      { kind: "resume", at: at(18, 11) },
      { kind: "start", at: at(17, 55) },
      { kind: "live", at: at(18, 42) },
    ]);
  });

  it("starts from the recording window, so 'From 17:55' matches the timeline's first label (issue #32)", () => {
    const choice = watchChoice({ ...window, live: true, now: at(18, 42) });
    expect(choice.options.find((option) => option.kind === "start")?.at).toBe(window.windowStart);
  });

  it("leaves Resume out without a position, with Watch from start primary", () => {
    const choice = watchChoice({ ...window, live: true, now: at(18, 42) });
    expect(choice.options.map((option) => option.kind)).toEqual(["start", "live"]);
  });

  it("treats a position at the live edge as no position", () => {
    const choice = watchChoice({
      ...window,
      live: true,
      now: at(18, 42),
      resumeAt: at(18, 42) - 10_000,
    });
    expect(choice.options[0]?.kind).toBe("start");
  });

  it("offers Resume and Play from the beginning for a finished recording you started", () => {
    const choice = watchChoice({
      ...window,
      live: false,
      now: at(22, 0),
      resumeAt: at(17, 55) + 46.5 * MIN,
    });
    expect(choice.options.map((option) => option.kind)).toEqual(["resume", "start"]);
    expect(choice.direct).toBe(false);
  });

  it("plays a finished recording without a position directly", () => {
    const choice = watchChoice({ ...window, live: false, now: at(22, 0) });
    expect(choice.direct).toBe(true);
    expect(choice.options).toEqual([{ kind: "start", at: window.windowStart }]);
  });
});

const T = Date.UTC(2026, 10, 23, 20);
/** A recording 20:00 to 22:00 with 5 minutes before and 10 after. */
const of = (state: ChoiceRecording["state"], positionMillis: number, watched = false) => ({
  id: RecordingId.make("r1"),
  state,
  start: DateTime.makeUnsafe(T),
  end: DateTime.makeUnsafe(T + 2 * HOUR),
  padding: { beforeMinutes: 5, afterMinutes: 10 },
  positionMillis,
  watched,
});

describe("watchChoiceFor", () => {
  it("asks Resume or Play from the beginning for a finished recording with a position", () => {
    const choice = watchChoiceFor(of("completed", 46 * MINUTE), T + 3 * HOUR);
    expect(choice?.options).toEqual([
      { kind: "resume", at: T - 5 * MINUTE + 46 * MINUTE },
      { kind: "start", at: T - 5 * MINUTE },
    ]);
    expect(choice?.live).toBe(false);
    expect(choice?.direct).toBe(false);
  });

  it("adds Watch live, last, while it still records, with or without a position", () => {
    const now = T + HOUR;
    const choice = watchChoiceFor(of("recording", 20 * MINUTE), now);
    expect(choice?.options.map((option) => option.kind)).toEqual(["resume", "start", "live"]);
    expect(choice?.options[2]).toEqual({ kind: "live", at: now });
    expect(watchChoiceFor(of("recording", 0), now)?.options.map((option) => option.kind)).toEqual([
      "start",
      "live",
    ]);
  });

  it("plays a finished one directly without a resume point worth asking about", () => {
    expect(watchChoiceFor(of("completed", 0), T + 3 * HOUR)?.direct).toBe(true);
    expect(watchChoiceFor(of("completed", 46 * MINUTE, true), T + 3 * HOUR)?.direct).toBe(true);
    // Within half a minute of the end: nothing left to resume.
    const length = 2 * HOUR + 15 * MINUTE;
    expect(watchChoiceFor(of("completed", length - 10_000), T + 3 * HOUR)?.direct).toBe(true);
    expect(watchChoiceFor(of("scheduled", 0), T - HOUR)).toBeUndefined();
  });
});
