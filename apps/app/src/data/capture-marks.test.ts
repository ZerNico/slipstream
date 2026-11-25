import { HOUR, MINUTE, type PathLabels } from "@slipstream/domain";
import { describe, expect, it } from "vitest";
import { recording } from "../../tests/fixtures.ts";
import { captureMarks, placeOf } from "./capture-marks.ts";

const T = Date.UTC(2026, 10, 23, 20);
const labels: PathLabels = {
  other: "Other",
  films: "Films",
  season: (season) => `Season ${season}`,
  episode: (episode) => `Episode ${episode}`,
  month: (year, month) => `${year}-${month}`,
  airing: () => "",
  film: (title) => title,
};

describe("captureMarks", () => {
  it("marks the programme inside its window and how far the viewer got", () => {
    const entry = recording({
      id: "r",
      channelId: "c",
      start: T,
      end: T + HOUR,
      beforeMinutes: 15,
      afterMinutes: 15,
      state: "recording",
      positionMillis: 45 * MINUTE,
    });
    const { marks, watched } = captureMarks(entry, T + HOUR / 2);
    expect(marks.ticks).toEqual([1 / 6, 5 / 6]);
    expect(marks.captured).toBe(0.5);
    expect(watched).toBe(0.5);
    expect(marks.played).toBe(0.5);
  });

  it("has no watched share for a watched or unstarted recording", () => {
    const entry = recording({ id: "r", channelId: "c", start: T, end: T + HOUR, watched: true });
    expect(captureMarks(entry, T).watched).toBeUndefined();
  });
});

describe("placeOf", () => {
  it("names the show only when it holds more than this recording", () => {
    const one = recording({
      id: "a",
      channelId: "c",
      start: T,
      end: T + HOUR,
      state: "completed",
      folders: ["Tatort"],
    });
    const two = recording({
      id: "b",
      channelId: "c",
      start: T - HOUR,
      end: T,
      state: "completed",
      folders: ["Tatort"],
    });
    expect(placeOf(one, [one], [], labels)).toBeUndefined();
    expect(placeOf(one, [one, two], [], labels)).toEqual({ key: "tatort", name: "Tatort" });
  });
});
