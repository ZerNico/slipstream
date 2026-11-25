/**
 * The capture engine as a server service (PLAN section 4): `@slipstream/recorder`'s capture
 * manager, scheduler, retention sweeper and disk guard, running over the SQLite adapters in
 * `repos.ts` for the server's lifetime. Its events, already in the domain's capture states, are
 * bridged into the database (`captures`, `capture_logs`, source health) and the server's event
 * bus.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
  Clock,
  Context,
  type DateTime,
  Deferred,
  Effect,
  FiberMap,
  Layer,
  Schema,
  Stream,
} from "effect";
import { Conflict, NotFound } from "@slipstream/api";
import {
  Capture,
  CaptureManager,
  type ConsumerKind,
  DiskGuard,
  FfmpegConfig,
  FfmpegRunner,
  type RecorderEvent,
  RecorderEvents,
  RecordingRepo,
  Reruns,
  RetentionSweeper,
  RuleRepo,
  Scheduler,
  Storage,
} from "@slipstream/recorder";
import {
  CaptureId,
  type CaptureError,
  CaptureReason,
  type CaptureState,
  ChannelId,
  type Padding,
  type ProgrammeId,
  RecordingId,
  SourceId,
  type UserId,
} from "@slipstream/domain";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { storeStreamInfo } from "../db/codec.ts";
import { captureLogs, captures, recordings, sources } from "../db/schema.ts";
import { EventBus } from "../events.ts";
import { PLANNING_HORIZON_MILLIS } from "../planning/service.ts";
import { loadCollections } from "../recordings/store.ts";
import {
  GuideRepoLive,
  HistoryRepoLive,
  LineupLive,
  LiveKeepPolicyLive,
  PlanningContextRepoLive,
  RecordingRepoLive,
  retentionCandidates,
  retentionGroups,
  RetentionPoliciesLive,
  RuleRepoLive,
  SegmentRepoLive,
} from "./repos.ts";

/** A live viewer holds a capture at most this long without a new session (tokens expire too). */
const LIVE_HOLD_MILLIS = 6 * 3_600_000;
/** Default for how long a live viewer keeps its capture without fetching anything. */
export const DEFAULT_LIVE_IDLE_MILLIS = 60_000;
/** Log lines kept per capture (the newest); matches what the capture log page reads. */
export const CAPTURE_LOG_LIMIT = 500;

/** A live viewer's hold on a channel capture. */
interface LiveHold {
  readonly channelId: string;
  lastAccessMs: number;
}

/** The recorder could not start what was asked, e.g. no stream for the channel. */
export class RecorderFailed extends Schema.TaggedError<RecorderFailed>()("RecorderFailed", {
  reason: CaptureReason,
}) {}

/** A manual time range to record. */
export interface RangeRecording {
  readonly channelId: ChannelId;
  readonly title: string;
  readonly start: DateTime.Utc;
  readonly end: DateTime.Utc;
  readonly ownerId: UserId;
  /** Extra time around the range; none when absent. */
  readonly padding?: Padding;
}

/**
 * One upstream stream in use: a channel's shared capture, the source it holds a slot on (absent
 * while it waits for one, and while it lingers after its last viewer left: then its stream goes
 * to anyone who needs one) and who uses it. Recording consumers are recording ids, live consumers
 * playback session ids.
 */
export interface UpstreamStream {
  readonly channelId: ChannelId;
  readonly sourceId: SourceId | undefined;
  /** When the channel's capture session started, epoch ms. */
  readonly startedAtMs: number;
  readonly consumers: ReadonlyArray<{
    readonly id: string;
    readonly kind: ConsumerKind;
  }>;
}

/** The ffmpeg and ffprobe binaries from the configuration, for captures and probes. */
export const FfmpegLive = Layer.effect(
  FfmpegConfig,
  Effect.map(ServerConfig, (config) => ({
    ffmpeg: config.ffmpegPath,
    ffprobe: config.ffprobePath,
  })),
);

/** Short ffmpeg jobs (frame grabs, test encodes) over the configured binaries. */
export const FfmpegRunnerLive = FfmpegRunner.layer.pipe(Layer.provide(FfmpegLive));

const makeRecorder = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const bus = yield* EventBus;
  const config = yield* ServerConfig;
  const scheduler = yield* Scheduler;
  const manager = yield* CaptureManager;
  const events = yield* RecorderEvents;
  const repo = yield* RecordingRepo;
  const ruleRepo = yield* RuleRepo;
  const reruns = yield* Reruns;

  const live = yield* FiberMap.make<string>();
  /** The live holders and when each last fetched a playlist or segment. */
  const liveHolds = new Map<string, LiveHold>();
  const liveIdleMs = config.recorder?.liveIdleMs ?? DEFAULT_LIVE_IDLE_MILLIS;

  const log = (captureId: string, level: "info" | "warning" | "error", message: string) =>
    Effect.flatMap(Clock.currentTimeMillis, (at) =>
      write
        .insert(captureLogs)
        .values({ captureId, at, level, message })
        .pipe(Effect.asVoid, Effect.orDie),
    );

  /**
   * Stores one ffmpeg (or recorder) line for a capture and drops its oldest lines beyond
   * {@link CAPTURE_LOG_LIMIT}, so a capture that keeps complaining cannot fill the database.
   */
  const ffmpegLog = (captureId: string, level: "info" | "warning" | "error", message: string) =>
    Effect.gen(function* () {
      yield* log(captureId, level, message);
      yield* write
        .delete(captureLogs)
        .where(
          and(
            eq(captureLogs.captureId, captureId),
            lt(
              captureLogs.id,
              sql`(select ${captureLogs.id} from ${captureLogs} where ${captureLogs.captureId} = ${captureId} order by ${captureLogs.id} desc limit 1 offset ${CAPTURE_LOG_LIMIT - 1})`,
            ),
          ),
        )
        .pipe(Effect.asVoid, Effect.orDie);
    });

  const publishCapture = (captureId: CaptureId, channelId: ChannelId, state: CaptureState) =>
    bus.publish({ _tag: "CaptureChanged", captureId, channelId, state });

  /** Ends the open row of one capture run, as `state`. */
  const closeCapture = (
    captureId: CaptureId,
    channelId: ChannelId,
    state: "stopped" | "failed",
    error: CaptureError | undefined,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const closed = yield* write
        .update(captures)
        .set({ state, endedAt: now, ...(error === undefined ? {} : { error }) })
        .where(and(eq(captures.id, captureId), isNull(captures.endedAt)))
        .returning({ id: captures.id })
        .pipe(Effect.orDie);
      if (closed.length > 0) yield* publishCapture(captureId, channelId, state);
    });

  const onCaptureChanged = (event: Extract<RecorderEvent, { _tag: "CaptureChanged" }>) =>
    Effect.gen(function* () {
      const reason = event.reason === undefined ? "" : ` (${event.reason})`;
      const { captureId } = event;
      switch (event.state) {
        case "starting":
          // The segment index opened its row before the run started.
          yield* log(captureId, "info", `capture starting on ${event.sourceStreamId}`);
          yield* publishCapture(captureId, event.channelId, "starting");
          return;
        case "stopped":
          yield* log(captureId, "info", `capture ended: ${event.state}${reason}`);
          yield* closeCapture(captureId, event.channelId, "stopped", undefined);
          return;
        case "failed":
          yield* log(captureId, "warning", `capture failed${reason}`);
          yield* closeCapture(captureId, event.channelId, "failed", event.error);
          return;
        case "reconnecting":
        case "running": {
          const { state } = event;
          yield* write
            .update(captures)
            .set(
              event.state === "reconnecting"
                ? {
                    state,
                    stats: sql`json_set(${captures.stats}, '$.reconnects', json_extract(${captures.stats}, '$.reconnects') + 1)`,
                  }
                : { state },
            )
            .where(eq(captures.id, captureId))
            .pipe(Effect.orDie);
          if (event.state === "reconnecting") {
            yield* log(captureId, "warning", `reconnecting${reason}`);
          }
          yield* publishCapture(captureId, event.channelId, state);
        }
      }
    });

  /** The provider refused a run's stream; the run's own `failed` event closes its row. */
  const onSourceRefused = (event: Extract<RecorderEvent, { _tag: "SourceRefused" }>) =>
    Effect.gen(function* () {
      const status = event.httpStatus === undefined ? "" : ` with HTTP ${event.httpStatus}`;
      yield* log(
        event.captureId,
        "error",
        `source refused stream ${event.sourceStreamId}${status}`,
      );
      const changed = yield* write
        .update(sources)
        .set({ health: "limitReached" })
        .where(and(eq(sources.id, event.sourceId), sql`${sources.health} <> 'limitReached'`))
        .returning({ id: sources.id })
        .pipe(Effect.orDie);
      for (const row of changed) {
        yield* bus.publish({
          _tag: "SourceHealthChanged",
          sourceId: SourceId.make(row.id),
          health: "limitReached",
        });
      }
    });

  /** Turns recorder events into database rows, log lines and server events. */
  const bridge = (event: RecorderEvent): Effect.Effect<void> => {
    switch (event._tag) {
      case "CaptureChanged":
        return onCaptureChanged(event);
      case "SourceRefused":
        return onSourceRefused(event);
      case "CaptureUnavailable":
        // No run to log into: the channel waits for a stream.
        return Effect.logDebug("No stream for a channel capture yet").pipe(
          Effect.annotateLogs({ channelId: event.channelId, reason: event.reason }),
        );
      case "CaptureLog":
        // ffmpeg's own words; "fatal" is an error as far as the log page is concerned.
        return ffmpegLog(
          event.captureId,
          event.level === "warning" ? "warning" : "error",
          event.message,
        );
      case "CaptureStats":
        return event.stats.bitrate === null
          ? Effect.void
          : write
              .update(captures)
              .set({
                stats: sql`json_set(${captures.stats}, '$.bitrateKbps', ${Math.round(event.stats.bitrate / 1000)})`,
              })
              .where(eq(captures.id, event.captureId))
              .pipe(Effect.asVoid, Effect.orDie);
      case "CaptureStreamDetected":
        return write
          .update(captures)
          .set({ streamInfo: storeStreamInfo(event.info) })
          .where(and(eq(captures.id, event.captureId), isNull(captures.streamInfo)))
          .pipe(Effect.asVoid, Effect.orDie);
      case "RecordingGap":
        // State changes are published by the repository; a gap changes only the problems.
        return bus.publish({
          _tag: "RecordingChanged",
          recordingId: event.recordingId,
          state: "recording",
        });
      case "ConsumerPreempted":
        return log(
          event.captureId,
          "warning",
          `consumer ${event.consumerId} lost the stream (${event.reason})`,
        );
      case "DiskSpaceLow":
        return Effect.logWarning("Disk space is low; making room").pipe(
          Effect.annotateLogs({ freeBytes: event.freeBytes, floorBytes: event.floorBytes }),
        );
      case "DiskSpaceRecovered":
        return Effect.logInfo("Disk space recovered").pipe(
          Effect.annotateLogs({ freeBytes: event.freeBytes }),
        );
      case "RetentionSwept":
        return Effect.logInfo("Retention deleted recordings and segments").pipe(
          Effect.annotateLogs({
            recordings: event.recordingIds.length,
            segments: event.segments,
            bytes: event.bytes,
          }),
        );
      case "RecordingReplaced":
        // Lists drop the original; the TV shows a toast (§3.7).
        return bus.publish({
          _tag: "RecordingReplaced",
          id: event.id,
          replacedId: event.replacedId,
        });
      case "RecordingEnded":
        // The state change itself went out from the repository; a recording that ended needing
        // a repeat changes its rerun line too, so its owners refetch it.
        return event.rerun === undefined
          ? Effect.void
          : bus.publish({
              _tag: "RecordingChanged",
              recordingId: event.recordingId,
              state: event.state,
            });
      case "RecordingStarted":
      case "RecordingFailed":
        return Effect.void;
    }
  };

  yield* events.events.pipe(
    Stream.runForEach((event) =>
      bridge(event).pipe(
        Effect.catchCause((cause) => Effect.logError("Handling a recorder event failed", cause)),
      ),
    ),
    Effect.forkScoped,
  );

  const releaseLive = (holderId: string) =>
    Effect.suspend(() => {
      liveHolds.delete(holderId);
      return FiberMap.remove(live, holderId);
    });

  /**
   * Completes once the holder has fetched nothing for `liveIdleMs` (closed tab, app in the
   * background), checking again whenever the deadline passes.
   */
  const idle = (hold: LiveHold) =>
    Effect.gen(function* () {
      while (true) {
        const now = yield* Clock.currentTimeMillis;
        const left = hold.lastAccessMs + liveIdleMs - now;
        if (left <= 0) return;
        yield* Effect.sleep(left);
      }
    });

  const touchLive = (holderId: string) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.sync(() => {
        const hold = liveHolds.get(holderId);
        if (hold === undefined) return false;
        hold.lastAccessMs = now;
        return true;
      }),
    );

  const acquireLive = (channelId: ChannelId, holderId: string) =>
    Effect.gen(function* () {
      const entry: LiveHold = { channelId, lastAccessMs: yield* Clock.currentTimeMillis };
      const ready = yield* Deferred.make<void, RecorderFailed>();
      const hold = Effect.scoped(
        Effect.gen(function* () {
          const lease = yield* manager.acquire(
            channelId,
            { id: holderId, kind: "live" },
            { wait: false },
          );
          yield* Deferred.succeed(ready, undefined);
          // Until released, preempted by a recording, idle, or the session's tokens expired.
          yield* Effect.raceAllFirst([
            Effect.asVoid(lease.dropped),
            idle(entry).pipe(
              Effect.andThen(
                Effect.logInfo("Releasing an idle live viewer").pipe(
                  Effect.annotateLogs({ channelId, holderId }),
                ),
              ),
            ),
            Effect.sleep(LIVE_HOLD_MILLIS),
          ]);
        }),
      ).pipe(
        Effect.catchTag("NoStreamAvailable", (error) =>
          Deferred.fail(ready, new RecorderFailed({ reason: error.reason })),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            // A newer acquire for the same holder may have replaced this one already.
            if (liveHolds.get(holderId) === entry) liveHolds.delete(holderId);
          }),
        ),
      );
      liveHolds.set(holderId, entry);
      yield* FiberMap.run(live, holderId, hold);
      yield* Deferred.await(ready);
    });

  const stop = (recordingId: RecordingId) =>
    scheduler.stop(recordingId).pipe(
      Effect.catchTags({
        RecordingNotFound: () =>
          Effect.fail(new NotFound({ entity: "recording", id: recordingId })),
        RecordingNotActive: () => Effect.fail(new Conflict({ code: "notRecording" })),
      }),
    );

  return {
    /** Records a guide programme; recording it twice adds the owner to the existing recording. */
    recordProgramme: (
      programmeId: ProgrammeId,
      options: { readonly ownerId: UserId; readonly padding: Padding },
    ) =>
      scheduler
        .recordProgramme(programmeId, options)
        .pipe(
          Effect.catchTag("ProgrammeNotFound", () =>
            Effect.fail(new NotFound({ entity: "programme", id: programmeId })),
          ),
        ),
    /** Records a manual time range on a channel. */
    recordRange: (request: RangeRecording) => scheduler.recordRange(request),
    /**
     * Cancels a scheduled recording, or ends a running one now: its range ends here and it
     * settles (completed, incomplete or failed) once the last segment has landed.
     */
    stop,
    /**
     * Ends a scheduled or running recording and completes once the scheduler let go of it: a
     * running one has released its capture and settled. One that already ended (or is gone)
     * completes at once.
     */
    stopAndSettle: (recordingId: RecordingId) =>
      scheduler.stop(recordingId).pipe(
        Effect.catchTags({
          RecordingNotFound: () => Effect.void,
          RecordingNotActive: () => Effect.void,
        }),
        Effect.andThen(scheduler.settled(recordingId)),
      ),
    /** Plans rules against the guide again and acts on anything due (after rule or padding edits). */
    replan: scheduler.replan,
    /** A live viewer joins or starts the channel's capture. `holderId` identifies the viewer. */
    acquireLive,
    /** The viewer is gone; unknown holders are ignored. */
    releaseLive,
    /**
     * The viewer fetched something. A holder that fetches nothing for the live idle timeout
     * (default 60 s) is released, as if it had said goodbye. `false` when the holder holds no
     * capture (never acquired, released, idle or preempted).
     */
    touchLive,
    /** Ends a capture for everyone: live viewers are released, running recordings stopped. */
    stopCapture: (captureId: string) =>
      Effect.gen(function* () {
        const [row] = yield* read
          .select({ channelId: captures.channelId })
          .from(captures)
          .where(eq(captures.id, captureId))
          .pipe(Effect.orDie);
        if (row === undefined) return;
        // Deleting the current entry while iterating a Map is safe.
        for (const [holderId, hold] of liveHolds) {
          if (hold.channelId === row.channelId) yield* releaseLive(holderId);
        }
        const running = yield* read
          .select({ id: recordings.id })
          .from(recordings)
          .where(and(eq(recordings.channelId, row.channelId), eq(recordings.state, "recording")))
          .pipe(Effect.orDie);
        for (const recording of running) {
          yield* Effect.ignore(stop(RecordingId.make(recording.id)));
        }
        // Nobody to keep it running for: it stops with its last consumer, keeping no buffer.
        yield* manager.stopWhenIdle(ChannelId.make(row.channelId));
      }),
    /** The channel captures running now, with their source slots and consumers (SPEC 7.9). */
    streams: Effect.map(manager.status, (statuses) =>
      statuses.map((status): UpstreamStream => ({
        channelId: status.channelId,
        // A lingering channel's stream is anyone's who needs one, so it counts on no source.
        sourceId: status.lingeringUntilMs === undefined ? status.stream?.sourceId : undefined,
        startedAtMs: status.startedAtMs,
        consumers: status.consumers.map((consumer) => ({ id: consumer.id, kind: consumer.kind })),
      })),
    ),
    /** How far back live viewers can rewind right now (the disk guard may have shrunk it). */
    dvrWindowMs: manager.dvrWindowMs,
    /**
     * "Skip this one" or "stop looking": the chain of `originalId` stops looking for good. Its
     * rerun line changed, so its owners refetch it (`RecordingChanged`).
     */
    declineRerun: (originalId: RecordingId) =>
      Effect.flatMap(reruns.declineRerun(originalId), (original) =>
        original === undefined
          ? Effect.void
          : bus.publish({
              _tag: "RecordingChanged",
              recordingId: original.id,
              state: original.state,
            }),
      ),
    /**
     * Plain "Delete" of a damaged original whose repeat is still looked for: its segments go at
     * once, the row stays hidden as the chain's anchor until the chain ends (§3.7 step 7).
     */
    hideAnchor: (recordingId: RecordingId, now: number) =>
      Effect.asVoid(reruns.hideAnchor(recordingId, now)),
    /**
     * "Keep the original" on a repeat (§3.7 step 3): the original it replaced comes back, its
     * chain ends as `kept`. Conflict `notARepeat`, `notReplaced` (also for an anchor) or
     * `keepOriginalExpired` otherwise.
     */
    keepOriginal: (repeatId: RecordingId, now: number) =>
      reruns.keepOriginal(repeatId, now).pipe(
        Effect.catchTags({
          RerunRecordingNotFound: (error) =>
            Effect.fail(new NotFound({ entity: "recording", id: error.recordingId })),
          KeepOriginalRefused: (error) =>
            Effect.fail(
              new Conflict({
                code: error.reason === "expired" ? "keepOriginalExpired" : error.reason,
              }),
            ),
        }),
      ),
    /**
     * A rule went away: the chains of its recordings (`originalIds`, read before the rule was
     * deleted) stop looking, and their anchors are removed (`RecordingRemoved` goes out).
     */
    endChains: (originalIds: ReadonlyArray<RecordingId>) => reruns.endChains(originalIds),
    /** What the next retention run deletes, and why. */
    retention: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const all = yield* repo.list;
      const groups = retentionGroups(
        all,
        yield* loadCollections(read),
        yield* ruleRepo.list,
        config.timeZone,
      );
      return retentionCandidates(all, groups, now);
    }),
  };
});

/**
 * The capture engine: records programmes and ranges, holds live captures for viewers, and
 * reports the streams in use and what retention deletes next.
 */
export class Recorder extends Context.Service<Recorder, Effect.Success<typeof makeRecorder>>()(
  "@slipstream/server/Recorder",
) {
  /**
   * The recorder over SQLite, with captures under `<dataDir>/captures`. Closing the layer stops
   * every capture (ffmpeg processes are scoped).
   */
  static readonly layer = Layer.unwrap(
    Effect.map(ServerConfig, (config) => {
      const root = join(config.dataDir, "captures");
      mkdirSync(root, { recursive: true });
      const tuning = config.recorder ?? {};
      const ports = Layer.mergeAll(
        RecordingRepoLive,
        SegmentRepoLive,
        GuideRepoLive,
        RuleRepoLive,
        PlanningContextRepoLive,
        HistoryRepoLive,
        LineupLive,
        LiveKeepPolicyLive,
        Storage.node(config.dataDir),
      ).pipe(Layer.provideMerge(RecorderEvents.layer));
      const manager = CaptureManager.layer({
        root,
        ...(tuning.segmentSeconds === undefined ? {} : { segmentSeconds: tuning.segmentSeconds }),
        ...(tuning.dvrWindowMs === undefined ? {} : { dvrWindowMs: tuning.dvrWindowMs }),
      }).pipe(
        Layer.provideMerge(Capture.layer.pipe(Layer.provide(FfmpegLive))),
        Layer.provideMerge(ports),
      );
      const engine = Layer.mergeAll(
        Scheduler.layer({
          timeZone: config.timeZone,
          horizonHours: PLANNING_HORIZON_MILLIS / 3_600_000,
          ...(tuning.endGraceMs === undefined ? {} : { endGraceMs: tuning.endGraceMs }),
        }),
        Layer.mergeAll(
          DiskGuard.layer({ floorBytes: config.freeSpaceFloorBytes }),
          Reruns.layer,
        ).pipe(
          Layer.provideMerge(RetentionSweeper.layer({ timeZone: config.timeZone })),
          Layer.provideMerge(RetentionPoliciesLive),
        ),
      ).pipe(Layer.provideMerge(manager));
      return Layer.effect(Recorder, makeRecorder).pipe(Layer.provide(engine));
    }),
  );
}
