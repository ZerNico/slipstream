import { HOUR, MINUTE, PlaybackState } from "@slipstream/domain";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { channel, recording } from "../../tests/fixtures.ts";
import { homeModel, pickHero } from "./home.ts";

const T = Date.UTC(2026, 10, 22, 5);
const names = new Map([["f1", "Sky Sport F1"]]);

const state = (recordingId: string, positionMinutes: number, updatedAt: number, watched = false) =>
  Schema.decodeUnknownSync(PlaybackState)({
    userId: "u1",
    target: { _tag: "Recording", recordingId },
    positionMillis: positionMinutes * MINUTE,
    watched,
    updatedAt: new Date(updatedAt).toISOString(),
  });

describe("pickHero", () => {
  const race = recording({
    id: "race",
    channelId: "f1",
    start: T,
    end: T + 2 * HOUR,
    state: "recording",
    beforeMinutes: 5,
    afterMinutes: 60,
  });
  const later = recording({ id: "later", channelId: "f1", start: T + 5 * HOUR, end: T + 6 * HOUR });
  const old = recording({
    id: "old",
    channelId: "f1",
    start: T - 9 * HOUR,
    end: T - 8 * HOUR,
    state: "completed",
  });

  it("leads with the running recording and its padded range", () => {
    expect(pickHero([later, old, race], names, T + HOUR)).toMatchObject({
      kind: "recording",
      recordingId: "race",
      channelName: "Sky Sport F1",
      capturedFrom: T - 5 * MINUTE,
      recordingUntil: T + 3 * HOUR,
    });
  });

  it("falls back to the next scheduled one, then the latest finished one", () => {
    expect(pickHero([later, old], names, T)?.kind).toBe("next");
    expect(pickHero([old], names, T)?.recordingId).toBe("old");
    expect(pickHero([], names, T)).toBeUndefined();
  });
});

describe("homeModel", () => {
  it("lists unwatched positions, most recent first, with the time left", () => {
    const quali = recording({
      id: "quali",
      channelId: "f1",
      start: T - 24 * HOUR,
      end: T - 23 * HOUR,
      state: "completed",
    });
    const pate = recording({
      id: "pate",
      channelId: "f1",
      start: T - 48 * HOUR,
      end: T - 46 * HOUR,
      state: "completed",
    });
    const done = recording({
      id: "done",
      channelId: "f1",
      start: T - 50 * HOUR,
      end: T - 49 * HOUR,
      state: "completed",
    });
    const model = homeModel(
      [quali, pate, done],
      [channel("f1", "Sky Sport F1", 106)],
      [
        state("pate", 30, T - 10),
        state("quali", 15, T - 5),
        state("done", 60, T - 1, true),
        state("gone", 5, T),
      ],
      T,
    );
    expect(
      model.continueWatching.map((item) => [item.recordingId, item.secondsLeft, item.progress]),
    ).toEqual([
      ["quali", 45 * 60, 0.25],
      ["pate", 90 * 60, 0.25],
    ]);
  });
});
