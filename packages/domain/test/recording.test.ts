import { describe, expect, it } from "vitest";
import {
  isActive,
  isAnchor,
  isHidden,
  isPlayable,
  isProblemRecording,
  isRecorded,
  RecordingState,
} from "../src/recording.ts";
import { at } from "./test-support.ts";

const hiddenAt = at("2026-11-23T12:00:00Z");

describe("why a recording is hidden", () => {
  it("is an anchor only when hidden as deleted", () => {
    expect(isAnchor({ hiddenAt, hiddenReason: "deleted" })).toBe(true);
    expect(isAnchor({ hiddenAt, hiddenReason: "replaced" })).toBe(false);
    expect(isAnchor({ hiddenReason: "deleted" })).toBe(false);
    expect(isAnchor({})).toBe(false);
  });

  it("is hidden for either reason", () => {
    expect(isHidden({ hiddenAt })).toBe(true);
    expect(isHidden({})).toBe(false);
  });
});

const states = (test: (recording: { readonly state: RecordingState }) => boolean) =>
  RecordingState.literals.filter((state) => test({ state }));

describe("recording states read as groups", () => {
  it("names the active, playable, recorded and problem states once", () => {
    expect(states(isActive)).toEqual(["scheduled", "recording"]);
    expect(states(isPlayable)).toEqual(["recording", "completed", "incomplete"]);
    expect(states(isRecorded)).toEqual(["completed", "incomplete"]);
    expect(states(isProblemRecording)).toEqual(["incomplete", "failed"]);
  });
});
