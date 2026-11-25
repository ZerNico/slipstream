import { PlaybackProgress } from "@slipstream/api";
import { MINUTE, progressSaveIntervalMs, watchedThreshold } from "@slipstream/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { makeProgressSaver, progressAt, type SaveReason } from "./progress.ts";
import type { PlayerProgress } from "./seek.ts";

const recordingId = "r1" as Parameters<typeof progressAt>[0];

/** A saver whose saves are collected as [seconds into the recording, reason]. */
const collecting = () => {
  const saves: [number, SaveReason][] = [];
  const saver = makeProgressSaver((at, reason) => saves.push([at.currentTime, reason]));
  return { saves, saver };
};

/** Reports one progress event per second from `from` to `to` seconds, at wall-clock `t0`. */
const play = (
  saver: ReturnType<typeof makeProgressSaver>,
  from: number,
  to: number,
  t0 = 1_000_000,
) => {
  for (let second = from; second <= to; second++) {
    saver.report({ currentTime: second, seekableDuration: 3600 }, t0 + second * 1000);
  }
};

describe("makeProgressSaver", () => {
  it("stores the position every 15 s while playing, as the web player does", () => {
    const { saves, saver } = collecting();
    play(saver, 0, 50);
    expect(progressSaveIntervalMs).toBe(15_000);
    expect(saves).toEqual([
      [15, "tick"],
      [30, "tick"],
      [45, "tick"],
    ]);
  });

  it("stores at once on pause, and not again while paused at the same position", () => {
    const { saves, saver } = collecting();
    play(saver, 0, 4);
    saver.pause();
    expect(saves).toEqual([[4, "pause"]]);
    // A paused player keeps reporting the same position.
    for (let tick = 1; tick <= 30; tick++) {
      saver.report({ currentTime: 4, seekableDuration: 3600 }, 1_004_000 + tick * 1000);
    }
    saver.pause();
    expect(saves).toEqual([[4, "pause"]]);
  });

  it("stores the last position on close and nothing after it", () => {
    const { saves, saver } = collecting();
    play(saver, 0, 17);
    saver.close();
    play(saver, 18, 40);
    saver.pause();
    expect(saves).toEqual([
      [15, "tick"],
      [17, "close"],
    ]);
  });

  it("never stores before the player reported a position", () => {
    const { saves, saver } = collecting();
    saver.pause();
    saver.close();
    expect(saves).toEqual([]);
  });
});

/** The player an hour into a recording `seekableDuration` long. */
const at = (currentTime: number, seekableDuration = 3600): PlayerProgress => ({
  currentTime,
  seekableDuration,
});

describe("progressAt", () => {
  it("stores the offset into the playlist in whole milliseconds, as the API accepts it", () => {
    const progress = progressAt(recordingId, at(754.3216), "completed");
    expect(progress.positionMillis).toBe(754_322);
    expect(Schema.encodeSync(PlaybackProgress)(progress)).toEqual({
      target: { _tag: "Recording", recordingId: "r1" },
      positionMillis: 754_322,
      watched: false,
    });
  });

  it("marks a finished recording watched within the last minute", () => {
    expect(watchedThreshold).toBe(MINUTE);
    expect(progressAt(recordingId, at(3600 - 61), "completed").watched).toBe(false);
    expect(progressAt(recordingId, at(3600 - 59), "completed").watched).toBe(true);
    expect(progressAt(recordingId, at(3600), "incomplete").watched).toBe(true);
  });

  it("never marks a running recording, or one whose state is unknown, watched", () => {
    expect(progressAt(recordingId, at(3600), "recording").watched).toBe(false);
    expect(progressAt(recordingId, at(3600), undefined).watched).toBe(false);
    expect(progressAt(recordingId, at(10, Number.NaN), "completed").watched).toBe(false);
  });
});
