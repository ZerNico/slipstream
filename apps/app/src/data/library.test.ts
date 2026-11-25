import { HOUR, MINUTE, type PathLabels } from "@slipstream/domain";

import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { recording } from "../../tests/fixtures.ts";
import { libraryCard, libraryView } from "./library.ts";

const T = Date.UTC(2026, 10, 22, 5);
const names = new Map([["f1", "Sky Sport F1"]]);
const labels: PathLabels = {
  other: "Other",
  films: "Films",
  season: (season) => `Season ${season}`,
  episode: (episode) => `Episode ${episode}`,
  month: (year, month) => `${year}-${month}`,
  airing: (start) => new Date(DateTime.toEpochMillis(start)).toISOString(),
  film: (title) => title,
};

const qualifying = recording({
  id: "quali",
  channelId: "f1",
  start: T - 24 * HOUR,
  end: T - 23 * HOUR,
  state: "completed",
  title: "F1: Qualifying",
  folders: ["Formel 1", "2026"],
  positionMillis: 15 * MINUTE,
});
const practice = recording({
  id: "practice",
  channelId: "f1",
  start: T - 48 * HOUR,
  end: T - 47 * HOUR,
  state: "completed",
  folders: ["Formel 1", "2026"],
  watched: true,
  positionMillis: 60 * MINUTE,
});
const film = recording({
  id: "film",
  channelId: "arte",
  start: T - 30 * HOUR,
  end: T - 28 * HOUR,
  state: "incomplete",
});
const race = recording({
  id: "race",
  channelId: "f1",
  start: T,
  end: T + 2 * HOUR,
  state: "recording",
  folders: ["Formel 1", "2026"],
  watched: true,
});
const upcoming = recording({ id: "next", channelId: "f1", start: T + HOUR, end: T + 2 * HOUR });
const failed = recording({ id: "fail", channelId: "f1", start: T - HOUR, end: T, state: "failed" });
const all = [practice, film, upcoming, race, failed, qualifying];

describe("libraryView", () => {
  it("leads with what is recording and puts everything playable in its place", () => {
    const view = libraryView(all, [], labels, "all");
    expect(view.running.map((entry) => entry.id)).toEqual(["race"]);
    expect(view.groups.map((group) => [group.name, group.entries.map((e) => e.id)])).toEqual([
      ["film", ["film"]],
      ["Formel 1", ["race", "quali", "practice"]],
    ]);
    expect(view.scheduled).toBe(1);
  });

  it("resumes where the viewer stopped and starts watched or new ones from the start", () => {
    expect(libraryCard(qualifying, names, labels)).toMatchObject({
      from: "resume",
      progress: 0.25,
      secondsLeft: 45 * 60,
      channelName: "Sky Sport F1",
      label: "F1: Qualifying",
    });
    expect(libraryCard(practice, names, labels)).toMatchObject({
      from: "start",
      watched: true,
      progress: 1,
      secondsLeft: 3600,
    });
  });

  it("hides watched recordings when filtering, but never a running one", () => {
    const view = libraryView(all, [], labels, "unwatched");
    expect(view.running.map((entry) => entry.id)).toEqual(["race"]);
    expect(view.groups.flatMap((group) => group.entries.map((e) => e.id))).toEqual([
      "film",
      "race",
      "quali",
    ]);
  });

  it("has no places for a library with nothing to play", () => {
    expect(libraryView([upcoming, failed], [], labels, "all")).toEqual({
      running: [],
      groups: [],
      scheduled: 1,
    });
  });
});
