import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ChannelId, type RepeatRef } from "@slipstream/domain";
import { markWords } from "./labels.ts";

const copy = (state: RepeatRef["state"]): RepeatRef => ({
  start: DateTime.makeUnsafe(Date.UTC(2026, 10, 22, 14)),
  channelId: ChannelId.make("one"),
  state,
});

describe("a guide cell of an episode the viewer already has", () => {
  it("says already scheduled for a scheduled copy, as the TV does", () => {
    expect(markWords({ state: "repeat", of: copy("scheduled") })).toEqual(["already scheduled"]);
  });

  it("says already recorded for a recorded, running or deleted copy", () => {
    for (const state of ["completed", "incomplete", "recording", "history"] as const) {
      expect(markWords({ state: "repeat", of: copy(state) })).toEqual(["already recorded"]);
    }
  });
});
