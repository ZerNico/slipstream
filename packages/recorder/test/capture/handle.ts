/**
 * A capture running in the background with its events folded into a snapshot, so integration
 * tests can wait for a state instead of following the event stream themselves. The server uses
 * `Capture.run` directly (through the capture manager).
 */
import type { CaptureState } from "@slipstream/domain";
import { Effect, Fiber, PubSub, Stream, type Scope } from "effect";
import { Capture, type CaptureOptions } from "../../src/capture/capture.ts";
import type { CaptureFailed } from "../../src/capture/errors.ts";
import type {
  CaptureEvent,
  CaptureRun,
  ProbedStream,
  RunCounters,
  Segment,
} from "../../src/capture/model.ts";

/** Everything known about a capture right now. */
export interface CaptureSnapshot {
  readonly state: CaptureState;
  readonly runs: ReadonlyArray<CaptureRun>;
  readonly segments: ReadonlyArray<Segment>;
  readonly streamInfo: ProbedStream | null;
  readonly stats: RunCounters | null;
  readonly lastError: string | null;
}

/** A capture running in the background of the scope that started it. */
export interface CaptureHandle {
  /** Events from the moment of subscription on; use `snapshot` for what came before. */
  readonly events: Stream.Stream<CaptureEvent>;
  readonly snapshot: Effect.Effect<CaptureSnapshot>;
  /** Waits until the capture ends: stopped after a clean exit, or failed. */
  readonly join: Effect.Effect<void, CaptureFailed>;
}

interface MutableSnapshot {
  state: CaptureState;
  runs: Array<CaptureRun>;
  segments: Array<Segment>;
  streamInfo: ProbedStream | null;
  stats: RunCounters | null;
  lastError: string | null;
}

/** Folds one event into the snapshot. */
const applyEvent = (snapshot: MutableSnapshot, event: CaptureEvent): void => {
  switch (event._tag) {
    case "RunStarted":
      snapshot.runs.push(event.run);
      return;
    case "StreamDetected":
      snapshot.streamInfo = event.info;
      return;
    case "SegmentAdded":
      snapshot.state = "running";
      snapshot.segments.push(event.segment);
      return;
    case "Stats":
      snapshot.stats = event.stats;
      return;
    case "Log":
      if (event.level !== "warning") snapshot.lastError = event.message;
      return;
    case "RunEnded": {
      const at = snapshot.runs.findIndex((run) => run.runId === event.run.runId);
      if (at >= 0) snapshot.runs[at] = event.run;
      if (event.run.lastError) snapshot.lastError = event.run.lastError;
      return;
    }
    case "Reconnecting":
      snapshot.state = "reconnecting";
      return;
  }
};

/** Starts the capture in the background of the current scope; closing the scope stops it. */
export const startCapture = (
  options: CaptureOptions,
): Effect.Effect<CaptureHandle, never, Capture | Scope.Scope> =>
  Effect.gen(function* () {
    const capture = yield* Capture;
    const pubsub = yield* PubSub.unbounded<CaptureEvent>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub));
    const current: MutableSnapshot = {
      state: "starting",
      runs: [],
      segments: [],
      streamInfo: null,
      stats: null,
      lastError: null,
    };
    const fiber = yield* capture.run(options).pipe(
      Stream.runForEach((event) =>
        Effect.suspend(() => {
          applyEvent(current, event);
          return PubSub.publish(pubsub, event);
        }),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          current.state = exit._tag === "Success" ? "stopped" : "failed";
        }),
      ),
      Effect.forkScoped,
    );
    return {
      events: Stream.fromPubSub(pubsub),
      snapshot: Effect.sync(() => ({
        ...current,
        runs: [...current.runs],
        segments: [...current.segments],
      })),
      join: Fiber.join(fiber),
    };
  });
