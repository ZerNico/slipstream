import type { Band, TimelineData, TimeSpan } from "@slipstream/domain";
import {
  AT_LIVE_TOLERANCE,
  clockGaps,
  livePoint,
  mediaAt,
  type PlaybackSnapshot,
  wallAt,
} from "./live-position.ts";
import type { PlaybackStatus } from "./use-hls-playback.ts";
import type { SessionRefusal, StreamLimit } from "./use-playback-session.ts";

/*
 * Where playback is, in the two notations of SPEC §7.9: running things (live TV, a recording
 * still being captured) on the wall clock, finished recordings as a position of their length.
 * Pure, so the read-out, the timeline and the seek maths are tested without a browser.
 */

/** What is being played and what the guide knows about it. */
export interface PlayerSubject {
  /**
   * `running`: a recording still being captured or live TV, the live edge moves with the clock.
   * `finished`: a recording that has ended; positions run from 0:00 to its length.
   */
  readonly mode: "running" | "finished";
  /** The window the bar spans: the recording with its extra time, or the programme on air. */
  readonly window: TimeSpan | undefined;
  /** Where the programme itself starts (Home and "From start" go here while running). */
  readonly programmeStart?: number;
  /** Programme start and end ticks. */
  readonly marks?: readonly number[];
  /** Guide programmes inside the window, for the bands. */
  readonly bands?: readonly Band[];
  /** Where the source dropped out, wall clock. */
  readonly gaps?: readonly TimeSpan[];
}

/** Playback mapped onto the window, everything in epoch ms (finished: window start + position). */
export interface PlayerPosition {
  readonly timeline: TimelineData;
  /** Your position on the bar. */
  readonly position: number;
  /** The live edge (running) or the end of what can be played (finished). */
  readonly edge: number;
  /** Running: how far behind live; finished: 0. */
  readonly behindMs: number;
  /** Running and within a few seconds of live. */
  readonly atLive: boolean;
  /** Finished: the position from the start and the length, ms. */
  readonly offsetMs: number;
  readonly lengthMs: number;
  /** Finished: what is left to watch, ms. */
  readonly leftMs: number;
  /** Turns a time on the bar back into a media time for the video element, seconds. */
  readonly mediaTimeAt: (time: number) => number;
}

/** Without a guide window, the bar runs a little past live so the edge has room (ms). */
const headroomFor = (capturedMs: number) => Math.max(5 * 60_000, capturedMs / 4);

/** Media seconds to wall-clock epoch ms for a running stream. */
const wallOf = wallAt;

/** Where the source dropped out and where the playlist's own clock jumps, wall clock. */
const gapsOf = (snapshot: PlaybackSnapshot, subject: PlayerSubject): readonly TimeSpan[] => {
  const jumps = clockGaps(snapshot);
  return jumps.length === 0 ? (subject.gaps ?? []) : [...(subject.gaps ?? []), ...jumps];
};

/**
 * Maps a playback snapshot onto the subject's window. A running stream uses the playlist's own
 * clock (PROGRAM-DATE-TIME), so the bar, the knob and "LIVE 18:42" are real times; a finished
 * recording counts from its first second, so the labels read 0:00 to its length whatever the
 * playlist says about the clock.
 */
export const playerPosition = (
  snapshot: PlaybackSnapshot,
  subject: PlayerSubject,
): PlayerPosition => {
  const live = livePoint(snapshot);
  if (subject.mode === "finished") {
    const mediaLength = Math.max(0, (snapshot.seekableEnd - snapshot.seekableStart) * 1000);
    const start = subject.window?.start ?? 0;
    const lengthMs = subject.window ? subject.window.end - subject.window.start : mediaLength;
    const offsetMs = Math.min(
      lengthMs,
      Math.max(0, (snapshot.currentTime - snapshot.seekableStart) * 1000),
    );
    const capturedEnd = start + Math.min(lengthMs, mediaLength);
    return {
      timeline: {
        start,
        end: start + lengthMs,
        captured: { start, end: capturedEnd },
        playhead: start + offsetMs,
        ...(subject.gaps ? { gaps: subject.gaps } : {}),
        ...(subject.marks ? { marks: subject.marks } : {}),
        ...(subject.bands ? { bands: subject.bands } : {}),
      },
      position: start + offsetMs,
      edge: capturedEnd,
      behindMs: 0,
      atLive: false,
      offsetMs,
      lengthMs,
      leftMs: Math.max(0, lengthMs - offsetMs),
      mediaTimeAt: (time) =>
        Math.min(live, snapshot.seekableStart + Math.max(0, time - start) / 1000),
    };
  }
  const edge = wallOf(snapshot, live);
  const capturedStart = wallOf(snapshot, snapshot.seekableStart);
  const position = Math.min(edge, wallOf(snapshot, snapshot.currentTime));
  // The bar reaches back as far as the buffer does, into earlier programmes too; the
  // programme's window only sets where the bar ends.
  const window = subject.window
    ? { start: Math.min(subject.window.start, capturedStart), end: subject.window.end }
    : { start: capturedStart, end: edge + headroomFor(edge - capturedStart) };
  const behindMs = Math.max(0, (live - snapshot.currentTime) * 1000);
  const gaps = gapsOf(snapshot, subject);
  return {
    timeline: {
      start: window.start,
      end: Math.max(window.end, edge),
      captured: { start: capturedStart, end: edge },
      playhead: position,
      live: edge,
      ...(subject.gaps || gaps.length > 0 ? { gaps } : {}),
      ...(subject.marks ? { marks: subject.marks } : {}),
      ...(subject.bands ? { bands: subject.bands } : {}),
    },
    position,
    edge,
    behindMs,
    atLive: behindMs <= AT_LIVE_TOLERANCE * 1000,
    offsetMs: Math.max(0, position - window.start),
    lengthMs: window.end - window.start,
    leftMs: Math.max(0, window.end - position),
    mediaTimeAt: (time) => mediaAt(snapshot, time),
  };
};

/**
 * Where "From start" goes, as a time on the bar: the programme's own start while running (the
 * extra minutes before it are skipped, as the prototype does), the first second of a finished
 * recording. Held inside what was captured.
 */
export const fromStartTime = (subject: PlayerSubject, position: PlayerPosition): number => {
  const captured = position.timeline.captured;
  const floor = captured?.start ?? position.timeline.start;
  if (subject.mode === "finished") return floor;
  const target = subject.programmeStart ?? subject.window?.start ?? floor;
  return Math.min(position.edge, Math.max(floor, target));
};

/** Whether "From start" has anywhere to go: something before the current position was kept. */
export const canGoToStart = (position: PlayerPosition): boolean => {
  const captured = position.timeline.captured;
  return captured !== undefined && position.position - captured.start > 1000;
};

/**
 * Where a `?t=` deep link starts. The mini player and the choice dialog pass a wall-clock time
 * (epoch ms) for running recordings; a finished recording may also be given as a position in
 * ms. Anything below a year 2001 timestamp is a position.
 */
export const startTarget = (
  t: number,
):
  | { readonly kind: "clock"; readonly at: number }
  | { readonly kind: "offset"; readonly ms: number } =>
  t >= 1e12 ? { kind: "clock", at: t } : { kind: "offset", ms: t };

/** A problem the page knows before any stream loads. */
export type PagePlayerProblem = "notFound" | "offline" | "nothing";

/** What covers the picture instead of playback, if anything. */
export type PlayerProblem =
  | {
      readonly kind: PagePlayerProblem | "notCaptured" | "forbidden" | "unsupported" | "failed";
    }
  | { readonly kind: "limit"; readonly limit: StreamLimit };

/**
 * The one problem the player shows, first match wins: what the page knew, the server's refusal
 * (stream limit, range no longer captured, not allowed), a browser that cannot play HLS, then
 * any failure of the session or the stream.
 */
export const playerProblem = (input: {
  readonly page: PagePlayerProblem | undefined;
  readonly refusal: SessionRefusal | undefined;
  readonly status: PlaybackStatus;
  readonly sessionFailed: boolean;
}): PlayerProblem | undefined => {
  if (input.page !== undefined) return { kind: input.page };
  switch (input.refusal?._tag) {
    case "StreamLimit":
      return { kind: "limit", limit: input.refusal };
    case "NotCaptured":
      return { kind: "notCaptured" };
    case "Forbidden":
      return { kind: "forbidden" };
    case undefined:
      break;
  }
  if (input.status === "unsupported") return { kind: "unsupported" };
  if (input.status === "failed" || input.sessionFailed) return { kind: "failed" };
  return undefined;
};
