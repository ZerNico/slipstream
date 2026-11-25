import { HOUR, MINUTE } from "@slipstream/domain";
import { setLocale, setRegion, setTimeZone } from "@slipstream/i18n";
import { DateTime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recording } from "../../tests/fixtures.ts";
import { problemItems, watchAnyway } from "./problem-items.ts";

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

describe("problemItems", () => {
  it("lists one item per chain, titled failed or incomplete, newest first", () => {
    const failed = recording({
      id: "news",
      channelId: "ard",
      title: "Tagesschau",
      start: T - HOUR,
      end: T - 45 * MINUTE,
      state: "failed",
      noData: true,
    });
    const gappy = recording({
      id: "race",
      channelId: "f1",
      title: "Rennen",
      start: T - 5 * HOUR,
      end: T - 3 * HOUR,
      state: "incomplete",
      gaps: [[T - 4 * HOUR, T - 4 * HOUR + 2 * MINUTE]],
    });
    const items = problemItems([gappy, failed], T);
    expect(items.map((item) => [item.kind, item.title])).toEqual([
      ["problem", "Tagesschau failed"],
      ["problem", "Rennen is incomplete"],
    ]);
    const [first, second] = items;
    expect(first?.kind === "problem" && first.failed).toBe(true);
    expect(second?.kind === "problem" && second.text).toMatch(/2\smin/u);
    expect(watchAnyway(gappy)).toEqual({ _tag: "Recording", recordingId: "race", from: "start" });
  });

  it("leads with a repeat that replaced its damaged original within the day", () => {
    const repeat = recording({
      id: "repeat",
      channelId: "ard",
      title: "Tatort",
      start: T - 3 * HOUR,
      end: T - HOUR,
      state: "completed",
      replaces: "original",
    });
    if (repeat.replaces === undefined) throw new Error("no replaces fixture");
    const replaced = {
      ...repeat,
      replaces: { ...repeat.replaces, replacedAt: DateTime.makeUnsafe(T - HOUR) },
    };
    const items = problemItems([replaced], T);
    expect(items.map((item) => [item.kind, item.key])).toEqual([["replaced", "replaced:original"]]);
    expect(problemItems([replaced], T + 24 * HOUR)).toEqual([]);
  });
});
