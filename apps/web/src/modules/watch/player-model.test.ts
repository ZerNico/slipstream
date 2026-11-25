import { describe, expect, it } from "vitest";
import type { PlaybackSnapshot } from "./live-position.ts";
import {
  canGoToStart,
  fromStartTime,
  playerPosition,
  playerProblem,
  type PlayerSubject,
  startTarget,
} from "./player-model.ts";

const MIN = 60_000;
// 18:42 on the sample day, as epoch ms.
const live = Date.UTC(2026, 10, 22, 17, 42);

/** A running stream whose media time 0 is 17:55 and whose live point is 18:42. */
const running = (behindSeconds: number): PlaybackSnapshot => {
  const offset = live - 47 * MIN;
  return {
    currentTime: 47 * 60 - behindSeconds,
    seekableStart: 0,
    seekableEnd: 47 * 60,
    liveSync: 47 * 60,
    epochOffset: offset,
  };
};

const window = { start: live - 47 * MIN, end: live + 108 * MIN };
const subject: PlayerSubject = {
  mode: "running",
  window,
  programmeStart: window.start + 5 * MIN,
};

describe("playerPosition, running", () => {
  it("reaches back into the programme before this one as far as the buffer goes", () => {
    // Live TV on a channel that was tuned an hour before this programme began.
    const tunedEarly: PlaybackSnapshot = { ...running(0), seekableStart: -60 * 60 };
    const position = playerPosition(tunedEarly, subject);
    expect(position.timeline.start).toBe(window.start - 60 * MIN);
    expect(position.timeline.captured?.start).toBe(window.start - 60 * MIN);
    expect(position.timeline.end).toBe(window.end);
  });

  it("puts you, live and the captured range on the wall clock", () => {
    const position = playerPosition(running(31 * 60 + 30), subject);
    expect(position.edge).toBe(live);
    expect(position.behindMs).toBe((31 * 60 + 30) * 1000);
    expect(position.atLive).toBe(false);
    expect(position.timeline.live).toBe(live);
    expect(position.timeline.captured).toEqual({ start: window.start, end: live });
    expect(position.timeline.playhead).toBe(live - (31 * 60 + 30) * 1000);
  });

  it("counts a few seconds behind as live", () => {
    expect(playerPosition(running(2), subject).atLive).toBe(true);
    expect(playerPosition(running(10), subject).atLive).toBe(false);
  });

  it("maps a time on the bar back to media seconds", () => {
    const position = playerPosition(running(60), subject);
    expect(position.mediaTimeAt(window.start + 10 * MIN)).toBe(600);
  });

  it("goes from start to the programme start, inside what was captured", () => {
    const position = playerPosition(running(60), subject);
    expect(fromStartTime(subject, position)).toBe(window.start + 5 * MIN);
    expect(canGoToStart(position)).toBe(true);
  });

  it("without a guide window runs the bar a little past live", () => {
    const position = playerPosition(running(0), { mode: "running", window: undefined });
    expect(position.timeline.start).toBe(window.start);
    expect(position.timeline.end).toBeGreaterThan(live);
  });
});

describe("playerPosition, finished", () => {
  const finished: PlayerSubject = {
    mode: "finished",
    window: { start: 1_000_000, end: 1_000_000 + 75 * MIN },
  };
  const snapshot: PlaybackSnapshot = {
    currentTime: 100 + 15 * 60,
    seekableStart: 100,
    seekableEnd: 100 + 75 * 60,
    liveSync: null,
    epochOffset: 0,
  };

  it("counts from the first second, whatever the playlist's clock", () => {
    const position = playerPosition(snapshot, finished);
    expect(position.offsetMs).toBe(15 * MIN);
    expect(position.lengthMs).toBe(75 * MIN);
    expect(position.leftMs).toBe(60 * MIN);
    expect(position.timeline.live).toBeUndefined();
    expect(position.mediaTimeAt(1_000_000 + 30 * MIN)).toBe(100 + 30 * 60);
  });

  it("from start is the first second", () => {
    const position = playerPosition(snapshot, finished);
    expect(fromStartTime(finished, position)).toBe(1_000_000);
  });
});

describe("startTarget", () => {
  it("reads epoch times as the clock and small numbers as positions", () => {
    expect(startTarget(live)).toEqual({ kind: "clock", at: live });
    expect(startTarget(46 * MIN)).toEqual({ kind: "offset", ms: 46 * MIN });
  });
});

describe("playerProblem", () => {
  const none = {
    page: undefined,
    refusal: undefined,
    status: "ready",
    sessionFailed: false,
  } as const;

  it("shows nothing while all is well", () => {
    expect(playerProblem(none)).toBeUndefined();
    expect(playerProblem({ ...none, status: "loading" })).toBeUndefined();
  });

  it("puts what the page knew first, then the server's refusal", () => {
    expect(playerProblem({ ...none, page: "notFound", refusal: { _tag: "NotCaptured" } })).toEqual({
      kind: "notFound",
    });
    expect(playerProblem({ ...none, refusal: { _tag: "NotCaptured" }, status: "failed" })).toEqual({
      kind: "notCaptured",
    });
    expect(playerProblem({ ...none, refusal: { _tag: "Forbidden" } })).toEqual({
      kind: "forbidden",
    });
    const limit = { _tag: "StreamLimit", reason: "sourceFull" } as const;
    expect(playerProblem({ ...none, refusal: limit })).toEqual({ kind: "limit", limit });
  });

  it("tells an unsupported browser apart from a failed stream", () => {
    expect(playerProblem({ ...none, status: "unsupported" })).toEqual({ kind: "unsupported" });
    expect(playerProblem({ ...none, status: "failed" })).toEqual({ kind: "failed" });
    expect(playerProblem({ ...none, sessionFailed: true })).toEqual({ kind: "failed" });
  });
});
