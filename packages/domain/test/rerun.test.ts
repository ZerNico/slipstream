import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { RecordingId } from "../src/ids.ts";
import { type ChainMember, rerunState } from "../src/rerun.ts";
import { at } from "./test-support.ts";
import { recorded, tatortOnOne, tatortSunday, tatortWdr } from "./episode-fixtures.ts";

const until = at("2026-12-06T20:45:00Z");
const before = DateTime.toEpochMillis(at("2026-11-23T12:00:00Z"));
const after = DateTime.toEpochMillis(at("2026-12-07T00:00:00Z"));

/** Sunday's Tatort failed; a series recording made it, so it looks for its repeat. */
const original = { ...recorded(tatortSunday, { state: "failed" }), rerunUntil: until };

const repeat = (from = tatortOnOne, fields: Partial<ChainMember> = {}): ChainMember => ({
  id: RecordingId.make(`rec:${from.id}`),
  start: from.start,
  channelId: from.channelId,
  state: "scheduled",
  replacesId: original.id,
  ...fields,
});

describe("rerun state (§3.7)", () => {
  it("is replaced once a repeat replaced it", () => {
    const good = repeat(tatortOnOne, { state: "completed" });
    expect(rerunState({ ...original, replacedById: good.id }, [good], [], before)).toEqual({
      state: "replaced",
      repeat: { recordingId: good.id, start: good.start, channelId: good.channelId },
      until,
    });
  });

  it("reports the stored outcomes kept, declined and exhausted", () => {
    for (const outcome of ["kept", "declined", "exhausted"] as const) {
      expect(rerunState({ ...original, rerunOutcome: outcome }, [], [], before)?.state).toBe(
        outcome,
      );
    }
  });

  it("is scheduled while the plan has a repeat of it", () => {
    const planned = { start: tatortOnOne.start, channelId: tatortOnOne.channelId };
    expect(rerunState(original, [], [planned], before)?.state).toBe("scheduled");
    expect(rerunState(original, [repeat()], [], before)).toEqual({
      state: "scheduled",
      repeat: {
        recordingId: repeat().id,
        start: tatortOnOne.start,
        channelId: tatortOnOne.channelId,
      },
      until,
    });
  });

  it("is looking while it needs a repeat before the deadline with fewer than two attempts", () => {
    expect(rerunState(original, [], [], before)).toEqual({ state: "looking", until });
  });

  it("is exhausted once the deadline passed", () => {
    expect(rerunState(original, [], [], after)?.state).toBe("exhausted");
  });

  it("is exhausted after two failed repeats, and still looking after one", () => {
    const first = repeat(tatortOnOne, { state: "failed" });
    expect(rerunState({ ...original, rerunAttempts: 1 }, [first], [], before)?.state).toBe(
      "looking",
    );
    const second = repeat(tatortWdr, { state: "failed" });
    expect(rerunState({ ...original, rerunAttempts: 2 }, [first, second], [], before)?.state).toBe(
      "exhausted",
    );
  });

  it("has no state for a good recording or one without a deadline", () => {
    const { rerunUntil: _until, ...manual } = original;
    expect(rerunState(manual, [], [], before)).toBeUndefined();
    expect(rerunState({ ...recorded(tatortSunday), rerunUntil: until }, [], [], before)).toBe(
      undefined,
    );
  });
});
