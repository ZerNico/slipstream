import { describe, expect, it } from "vitest";
import { HOUR, MINUTE, RecordingId } from "@slipstream/domain";
import { recording } from "../../tests/fixtures.ts";
import { choiceTarget, pickRecording, pickTarget } from "./watch-choice.ts";

const T = Date.UTC(2026, 10, 23, 20);

describe("choiceTarget", () => {
  it("opens the player where the option says", () => {
    const id = RecordingId.make("r1");
    expect(choiceTarget(id, { kind: "resume", at: T })).toEqual({
      _tag: "Recording",
      recordingId: "r1",
      from: "resume",
    });
    expect(choiceTarget(id, { kind: "start", at: T }).from).toBe("start");
    expect(choiceTarget(id, { kind: "live", at: T }).from).toBe("live");
  });
});

describe("pickTarget", () => {
  const fresh = recording({
    id: "fresh",
    channelId: "c",
    start: T - 2 * HOUR,
    end: T - HOUR,
    state: "completed",
  });
  const started = recording({
    id: "started",
    channelId: "c",
    start: T - 2 * HOUR,
    end: T - HOUR,
    state: "completed",
    positionMillis: 10 * MINUTE,
  });
  const entries = [fresh, started];

  it("opens the sheet when there is nothing to play", () => {
    expect(pickTarget(undefined, entries, T)).toEqual({ _tag: "Sheet" });
    const scheduled = recording({
      id: "later",
      channelId: "c",
      start: T + HOUR,
      end: T + 2 * HOUR,
    });
    expect(pickRecording(scheduled, entries, T)._tag).toBe("Sheet");
  });

  it("plays a recording nobody started, and asks for one this profile started", () => {
    expect(pickRecording(fresh, entries, T)).toEqual({
      _tag: "Play",
      target: { _tag: "Recording", recordingId: "fresh", from: "start" },
    });
    expect(pickRecording(started, entries, T)._tag).toBe("Choose");
  });
});
