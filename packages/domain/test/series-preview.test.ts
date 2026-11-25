import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import type { RepeatState } from "../src/episode.ts";
import { ChannelId } from "../src/ids.ts";
import type { RuleMatchSkip } from "../src/planner.ts";
import {
  markTitle,
  newSeriesCollection,
  recordedCount,
  skipMarkParts,
} from "../src/series-editor.ts";

const berlin = "Europe/Berlin";
/** Sunday 22 November 2026, 15:00 in Berlin. */
const sunday = DateTime.makeUnsafe(Date.UTC(2026, 10, 22, 14));
/** Tuesday 24 November 2026, 20:15 in Berlin. */
const tuesday = DateTime.makeUnsafe(Date.UTC(2026, 10, 24, 19, 15));

const repeatOf = (state: RepeatState, start = sunday): RuleMatchSkip => ({
  _tag: "Repeat",
  of: { start, state, channelId: ChannelId.make("das-erste") },
});

describe("the series editor's preview (recording model §3.2)", () => {
  it("marks what the title conditions matched", () => {
    expect(
      markTitle("Live F1: Qualifying - GP Katar", [
        { _tag: "StartsWith", values: ["Live F1:"] },
        { _tag: "Contains", values: ["Qualifying", "Rennen"] },
      ]),
    ).toEqual([
      { text: "Live F1:", marked: true },
      { text: " ", marked: false },
      { text: "Qualifying", marked: true },
      { text: " - GP Katar", marked: false },
    ]);
  });

  it("names the day of the copy that counts, in the household's zone", () => {
    const zone = { isNew: false, timeZone: berlin };
    expect(skipMarkParts(repeatOf("completed"), zone)).toEqual({
      kind: "repeat",
      state: "recorded",
      day: "sun",
      date: 22,
      epochMs: Date.UTC(2026, 10, 22, 14),
    });
    expect(skipMarkParts(repeatOf("scheduled", tuesday), zone)).toMatchObject({
      state: "scheduled",
      day: "tue",
      date: 24,
    });
    expect(skipMarkParts(repeatOf("history"), zone)).toMatchObject({ state: "deleted" });
  });

  it("says the same airing as a scheduled recording only for a new draft", () => {
    expect(skipMarkParts({ _tag: "SameAiring" }, { isNew: true, timeZone: berlin })).toEqual({
      kind: "same",
    });
    expect(
      skipMarkParts({ _tag: "SameAiring" }, { isNew: false, timeZone: berlin }),
    ).toBeUndefined();
    expect(skipMarkParts({ _tag: "DuplicateEntry" }, { isNew: false, timeZone: berlin })).toEqual({
      kind: "duplicate",
    });
  });

  it("counts what gets recorded: not the episodes already there", () => {
    expect(
      recordedCount([{}, { skip: { _tag: "SameAiring" } }, { skip: repeatOf("completed") }]),
    ).toBe(2);
  });

  it("makes a new collection keyed on one channel and the title, or on any channel", () => {
    const one = newSeriesCollection("Live F1", {
      title: "Live F1: Rennen",
      channelId: ChannelId.make("sky"),
    });
    expect(one.name).toBe("Live F1");
    expect(one.matcher.channels).toEqual(["sky"]);
    expect(
      newSeriesCollection("Live F1", { title: "Live F1: Rennen", channelId: undefined }).matcher
        .channels,
    ).toEqual([]);
    expect(newSeriesCollection("Mine", { title: undefined, channelId: undefined }).matcher).toEqual(
      { channels: [], title: [], categories: [], weekdays: [] },
    );
  });
});
