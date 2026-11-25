/**
 * The capture manager: at most one upstream capture per channel, shared by every consumer
 * (recordings and live viewers) and running while at least one of them holds a lease (PLAN 4,
 * 6.3).
 *
 * Each channel capture is a session. Its supervisor picks the channel's best stream that a
 * source has room for, runs a capture on it and falls back to the next stream by priority when
 * the source refuses (403/429/509, immediate EOF) or keeps failing. Source stream limits are
 * enforced with recordings first: a recording that finds every stream busy takes one from a
 * channel that only live viewers use, and a recording refused by the provider frees
 * one of ours on that source and tries again. Live viewers never take a stream from a recording.
 */
import { join } from "node:path";
import { Capture, reconnectSchedule, type ReconnectOptions } from "./capture/capture.ts";
import { toStreamInfo, type CaptureEvent } from "./capture/model.ts";
import { GAP_TOLERANCE_MS } from "./capture/playlist.ts";
import {
  type CaptureError,
  CaptureId,
  CaptureReason,
  type CaptureState,
  ChannelId,
  type SourceId,
  type SourceStreamId,
} from "@slipstream/domain";
import {
  Clock,
  Context,
  Data,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Layer,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { RecorderEvents } from "./events.ts";
import {
  Lineup,
  SegmentRepo,
  streamsOf,
  type LineupSnapshot,
  type StoredSegment,
  type StreamCandidate,
} from "./ports.ts";
import { classifyEmptyRun, httpStatusIn } from "./refusal.ts";

/** Who needs a channel's capture. Lower rank wins a stream: a recording before live viewers. */
export type ConsumerKind = "recording" | "live";

const RANK: Record<ConsumerKind, number> = { recording: 0, live: 1 };

/** One consumer of a channel capture. Ids are unique per channel. */
export interface Consumer {
  readonly id: string;
  readonly kind: ConsumerKind;
}

/** What a lease holder hears about its channel's capture. */
export type ChannelEvent =
  | { readonly _tag: "Segment"; readonly segment: StoredSegment }
  /**
   * Wall-clock time between two segments with nothing captured (longer than
   * {@link GAP_TOLERANCE_MS}), also across captures when the channel moved to another stream.
   */
  | {
      readonly _tag: "Gap";
      readonly fromMs: number;
      readonly toMs: number;
      readonly reason: CaptureReason;
      /** Reconnect attempts made during the gap. */
      readonly retries: number;
    }
  | {
      readonly _tag: "StateChanged";
      readonly state: CaptureState;
      readonly stream: StreamCandidate | undefined;
      readonly reason: CaptureReason | undefined;
    }
  | {
      readonly _tag: "Refused";
      readonly stream: StreamCandidate;
      readonly httpStatus: number | undefined;
    }
  /** This consumer lost its stream to a recording. */
  | { readonly _tag: "Preempted"; readonly reason: CaptureReason };

/** Where a channel capture stands. */
export interface ChannelStatus {
  readonly channelId: ChannelId;
  readonly state: CaptureState;
  readonly stream: StreamCandidate | undefined;
  readonly consumers: ReadonlyArray<Consumer>;
  readonly startedAtMs: number;
  readonly lastSegmentEndMs: number | undefined;
}

/** A consumer's hold on a channel capture; the capture runs while any lease is open. */
export interface CaptureLease {
  readonly channelId: ChannelId;
  readonly consumer: Consumer;
  /** Events of the channel from the moment the lease was taken. */
  readonly events: Stream.Stream<ChannelEvent>;
  readonly status: Effect.Effect<ChannelStatus | undefined>;
  /** Completes with the reason when the manager drops this consumer to make room. */
  readonly dropped: Effect.Effect<CaptureReason>;
}

/** No stream for the channel right now, for a consumer that would rather not wait. */
export class NoStreamAvailable extends Schema.TaggedError<NoStreamAvailable>()(
  "NoStreamAvailable",
  { channelId: ChannelId, reason: CaptureReason },
) {}

/** A live viewer's DVR window: segments from `fromMs` on are in use. */
export interface LiveWindow {
  readonly channelId: ChannelId;
  readonly fromMs: number;
}

/** Tuning for the capture manager; everything but `root` has a default. */
export interface CaptureManagerOptions {
  /** Segment store root; captures go to `<root>/<channel>/<capture>/`. */
  readonly root: string;
  /** Default 6. */
  readonly segmentSeconds?: number;
  readonly stallTimeoutMs?: number;
  /**
   * Retries of failed runs (nothing produced, or dropped within the capture's healthy minimum
   * of 30 s) before a stream counts as failed and the next one is tried. Default: 1 s doubling
   * to 10 s, 3 retries.
   */
  readonly reconnect?: ReconnectOptions;
  /** How long a refused or failed stream is skipped. Default 60 s. */
  readonly cooldownMs?: number;
  /** How often a channel without a stream looks again (it also wakes when a stream frees). Default 5 s. */
  readonly retryDelayMs?: number;
  /** Pause after freeing a stream at the provider before asking it again. Default 1 s. */
  readonly preemptRetryMs?: number;
  /** How far back live viewers can rewind. Default 4 hours. */
  readonly dvrWindowMs?: number;
}

interface Entry {
  readonly consumer: Consumer;
  readonly dropped: Deferred.Deferred<CaptureReason>;
}

/** One capture run: an ffmpeg capture on one stream, from `starting` until it is closed. */
interface Run {
  readonly captureId: CaptureId;
  readonly directory: string;
  readonly stream: StreamCandidate;
  /** Until `stopped` or `failed` went out for it. */
  open: boolean;
}

interface Session {
  readonly channelId: ChannelId;
  readonly scope: Scope.Closeable;
  readonly pubsub: PubSub.PubSub<ChannelEvent>;
  readonly consumers: Map<string, Entry>;
  readonly startedAtMs: number;
  /** The stream this session holds a source slot for. */
  slot: StreamCandidate | undefined;
  state: CaptureState;
  /** The last state and stream told to listeners, so repeats stay quiet. */
  announced: string | undefined;
  sourceIds: ReadonlySet<SourceId>;
  lastSegmentEndMs: number | undefined;
  /** Why the capture last stopped delivering, for the next gap. */
  problem: CaptureReason | undefined;
  retries: number;
  /** The capture run on the current stream (kept after it ends, until the next one starts). */
  run: Run | undefined;
}

interface Cooldown {
  readonly untilMs: number;
  readonly reason: CaptureReason;
}

class Refusal extends Data.TaggedError("Refusal")<{ readonly httpStatus: number | undefined }> {}

type Outcome =
  | { readonly _tag: "Ended" }
  | { readonly _tag: "Refused"; readonly httpStatus: number | undefined }
  | { readonly _tag: "Failed"; readonly lastError: string | null };

const bestRank = (session: Session): number =>
  Math.min(...[...session.consumers.values()].map((entry) => RANK[entry.consumer.kind]));

/** A source's stream limit; `undefined` means unlimited. */
const limitOf = (snapshot: LineupSnapshot, sourceId: SourceId) =>
  snapshot.sources.find((source) => source.id === sourceId)?.maxStreams;

const safeName = (value: string) => value.replaceAll(/[^A-Za-z0-9._-]/g, "_");

/** What may be stored or shown of an ffmpeg line about `stream`: its credentials redacted. */
const redacted = (stream: StreamCandidate, text: string) => stream.redact?.(text) ?? text;

/** Shares one upstream capture per channel between recordings and viewers. */
export class CaptureManager extends Context.Service<
  CaptureManager,
  {
    /**
     * Joins (or starts) the channel's capture for the life of the current scope. With `wait`
     * (the default for recordings) a channel without a free stream waits for one; otherwise
     * it fails with {@link NoStreamAvailable}.
     */
    acquire(
      channelId: ChannelId,
      consumer: Consumer,
      options?: { readonly wait?: boolean },
    ): Effect.Effect<CaptureLease, NoStreamAvailable, Scope.Scope>;
    readonly status: Effect.Effect<ReadonlyArray<ChannelStatus>>;
    /** DVR windows of channels with live viewers, for retention. */
    readonly liveWindows: Effect.Effect<ReadonlyArray<LiveWindow>>;
    readonly dvrWindowMs: Effect.Effect<number>;
    /** Shrinks (or restores) the DVR window, e.g. when disk space runs low. */
    setDvrWindow(ms: number): Effect.Effect<void>;
  }
>()("@slipstream/recorder/CaptureManager") {
  /** The manager; closing the layer stops every capture. */
  static readonly layer = (options: CaptureManagerOptions) =>
    Layer.effect(CaptureManager, makeCaptureManager(options));
}

const makeCaptureManager = Effect.fnUntraced(function* (options: CaptureManagerOptions) {
  const capture = yield* Capture;
  const lineup = yield* Lineup;
  const segments = yield* SegmentRepo;
  const bus = yield* RecorderEvents;
  const managerScope = yield* Effect.scope;

  const cooldownMs = options.cooldownMs ?? 60_000;
  const retryDelayMs = options.retryDelayMs ?? 5000;
  const preemptRetryMs = options.preemptRetryMs ?? 1000;
  const reconnect = options.reconnect ?? { baseMs: 1000, maxMs: 10_000, maxRetries: 3 };

  const lock = yield* Semaphore.make(1);
  const sessions = new Map<ChannelId, Session>();
  /** Sessions being shut down still hold their stream until ffmpeg is gone. */
  const closing = new Set<Session>();
  const cooldowns = new Map<SourceStreamId, Cooldown>();
  const streamFreed = yield* PubSub.unbounded<void>();
  const dvrWindow = yield* Ref.make(options.dvrWindowMs ?? 4 * 3_600_000);
  let captureCounter = 0;

  const holders = (sourceId: SourceId) =>
    [...sessions.values(), ...closing].filter((session) => session.slot?.sourceId === sourceId);

  /** True when the free streams of a source are spoken for by better-ranked waiting channels. */
  const reservedForBetter = (snapshot: LineupSnapshot, sourceId: SourceId, session: Session) => {
    const limit = limitOf(snapshot, sourceId);
    if (limit === undefined) return false;
    const free = limit - holders(sourceId).length;
    const rank = bestRank(session);
    const waiting = [...sessions.values()].filter(
      (other) =>
        other !== session &&
        other.slot === undefined &&
        other.sourceIds.has(sourceId) &&
        bestRank(other) < rank,
    );
    return free <= waiting.length;
  };

  const hasRoom = (snapshot: LineupSnapshot, sourceId: SourceId) => {
    const limit = limitOf(snapshot, sourceId);
    return limit === undefined || holders(sourceId).length < limit;
  };

  /** Removes a session from the active set and tells its consumers why. Call under the lock. */
  const evict = (victim: Session, reason: CaptureReason) =>
    Effect.gen(function* () {
      sessions.delete(victim.channelId);
      closing.add(victim);
      for (const entry of victim.consumers.values()) {
        yield* Deferred.succeed(entry.dropped, reason);
        // A session that has not started a run yet has nothing to report it in.
        if (victim.run !== undefined) {
          yield* bus.publish({
            _tag: "ConsumerPreempted",
            channelId: victim.channelId,
            captureId: victim.run.captureId,
            consumerId: entry.consumer.id,
            reason,
          });
        }
      }
      yield* PubSub.publish(victim.pubsub, { _tag: "Preempted", reason });
      victim.consumers.clear();
      return victim;
    });

  /** The worst-ranked session on a source that a session of `rank` may take the stream from. */
  const victimOn = (sourceId: SourceId, rank: number) =>
    [...sessions.values()]
      .filter((other) => other.slot?.sourceId === sourceId && bestRank(other) > rank)
      .toSorted((a, b) => bestRank(b) - bestRank(a))[0];

  /**
   * Picks a stream for a session without one and claims its source slot, evicting a lower-ranked
   * session if a recording needs it. Call under the lock.
   */
  const claim = (session: Session, snapshot: LineupSnapshot, now: number) =>
    Effect.gen(function* () {
      const streams = streamsOf(snapshot, session.channelId);
      session.sourceIds = new Set(streams.map((stream) => stream.sourceId));
      if (streams.length === 0) {
        return { stream: undefined, victims: [], reason: "noStream" as CaptureReason };
      }
      const usable = streams.filter(
        (stream) => (cooldowns.get(stream.sourceStreamId)?.untilMs ?? 0) <= now,
      );
      const free = usable.find(
        (stream) =>
          hasRoom(snapshot, stream.sourceId) &&
          !reservedForBetter(snapshot, stream.sourceId, session),
      );
      if (free !== undefined) {
        session.slot = free;
        return { stream: free, victims: [], reason: undefined };
      }
      const rank = bestRank(session);
      if (rank === RANK.recording) {
        for (const stream of usable) {
          const victim = victimOn(stream.sourceId, rank);
          if (victim === undefined) continue;
          const evicted = yield* evict(victim, "preempted");
          session.slot = stream;
          return { stream, victims: [evicted], reason: undefined };
        }
      }
      const cooled = streams
        .map((stream) => cooldowns.get(stream.sourceStreamId))
        .find((cooldown) => cooldown !== undefined && cooldown.untilMs > now);
      const reason: CaptureReason =
        usable.length === 0 && cooled !== undefined ? cooled.reason : "sourceLimit";
      return { stream: undefined, victims: [], reason };
    });

  /** Closes evicted or abandoned sessions and frees their streams once ffmpeg is gone. */
  const shutDown = (gone: ReadonlyArray<Session>) =>
    Effect.forEach(
      gone,
      (session) =>
        Scope.close(session.scope, Exit.void).pipe(
          Effect.andThen(
            lock.withPermit(
              Effect.sync(() => {
                closing.delete(session);
                session.slot = undefined;
              }),
            ),
          ),
          Effect.andThen(PubSub.publish(streamFreed, undefined)),
          Effect.andThen(Effect.suspend(() => closeRun(session, "stopped"))),
        ),
      { discard: true },
    );

  /** Tells listeners a run changed state; repeats of the last announcement stay quiet. */
  const setState = (session: Session, run: Run, state: "starting" | "running" | "reconnecting") =>
    Effect.gen(function* () {
      const announced = `${state}:${run.captureId}`;
      if (session.announced === announced) return;
      session.announced = announced;
      session.state = state;
      yield* PubSub.publish(session.pubsub, {
        _tag: "StateChanged",
        state,
        stream: run.stream,
        reason: undefined,
      });
      yield* bus.publish({
        _tag: "CaptureChanged",
        channelId: session.channelId,
        state,
        captureId: run.captureId,
        directory: run.directory,
        sourceId: run.stream.sourceId,
        sourceStreamId: run.stream.sourceStreamId,
      });
    });

  /** The channel has no stream: it belongs to no run and waits for one. */
  const setUnavailable = (session: Session, reason: CaptureReason) =>
    Effect.gen(function* () {
      const announced = `failed:${reason}`;
      if (session.announced === announced) return;
      session.announced = announced;
      session.state = "failed";
      yield* PubSub.publish(session.pubsub, {
        _tag: "StateChanged",
        state: "failed",
        stream: undefined,
        reason,
      });
      yield* bus.publish({ _tag: "CaptureUnavailable", channelId: session.channelId, reason });
    });

  /** Closes the session's open run, once: it ended, was stopped, or failed with `error`. */
  const closeRun = (
    session: Session,
    state: "stopped" | "failed",
    reason?: CaptureReason,
    error?: CaptureError,
  ) =>
    Effect.gen(function* () {
      const run = session.run;
      if (run === undefined || !run.open) return;
      run.open = false;
      yield* bus.publish({
        _tag: "CaptureChanged",
        channelId: session.channelId,
        state,
        captureId: run.captureId,
        directory: run.directory,
        sourceId: run.stream.sourceId,
        sourceStreamId: run.stream.sourceStreamId,
        ...(reason === undefined ? {} : { reason }),
        ...(error === undefined ? {} : { error }),
      });
    });

  const onSegment = (session: Session, run: Run, segment: StoredSegment) =>
    Effect.gen(function* () {
      yield* segments.add(segment);
      const lastEnd = session.lastSegmentEndMs;
      if (lastEnd !== undefined && segment.startMs - lastEnd > GAP_TOLERANCE_MS) {
        yield* PubSub.publish(session.pubsub, {
          _tag: "Gap",
          fromMs: lastEnd,
          toMs: segment.startMs,
          reason: session.problem ?? "streamDropped",
          retries: session.retries,
        });
      }
      session.lastSegmentEndMs = Math.max(lastEnd ?? 0, segment.startMs + segment.durationMs);
      session.problem = undefined;
      session.retries = 0;
      yield* setState(session, run, "running");
      yield* PubSub.publish(session.pubsub, { _tag: "Segment", segment });
    });

  /** Names a new capture run on `stream`; its events carry the id from `starting` on. */
  /** A new run of the session's capture, recorded in the segment index before it starts. */
  const newRun = (session: Session, stream: StreamCandidate) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      captureCounter += 1;
      const captureId = CaptureId.make(`${safeName(session.channelId)}-${now}-${captureCounter}`);
      const run: Run = {
        captureId,
        directory: join(options.root, safeName(session.channelId), captureId),
        stream,
        open: true,
      };
      session.run = run;
      yield* segments.openCapture({
        captureId,
        channelId: session.channelId,
        directory: run.directory,
        sourceStreamId: stream.sourceStreamId,
        startedAtMs: now,
      });
      return run;
    });

  /** Runs one capture until it is refused, fails for good or ends. */
  const runStream = (session: Session, run: Run) =>
    Effect.gen(function* () {
      const { captureId, directory, stream } = run;
      const channelId = session.channelId;
      let httpStatus: number | undefined;
      const handle = (event: CaptureEvent): Effect.Effect<void, Refusal> => {
        switch (event._tag) {
          case "RunStarted":
            return Effect.sync(() => {
              httpStatus = undefined;
            });
          case "Log":
            httpStatus = httpStatusIn(event.message) ?? httpStatus;
            // ffmpeg quotes the input URL, credentials included: never pass that on.
            return bus.publish({
              _tag: "CaptureLog",
              channelId,
              captureId,
              runId: event.runId,
              level: event.level,
              message: redacted(stream, event.message),
            });
          case "Stats":
            return bus.publish({ _tag: "CaptureStats", channelId, captureId, stats: event.stats });
          case "StreamDetected":
            return Effect.flatMap(Clock.currentTimeMillis, (now) =>
              bus.publish({
                _tag: "CaptureStreamDetected",
                channelId,
                captureId,
                runId: event.runId,
                info: toStreamInfo(event.info, DateTime.makeUnsafe(now)),
              }),
            );
          case "SegmentAdded":
            return onSegment(session, run, {
              ...event.segment,
              channelId: session.channelId,
              directory,
            });
          case "RunEnded": {
            if (event.run.segments > 0) {
              return Effect.sync(() => {
                session.problem = "streamDropped";
              });
            }
            const cause = classifyEmptyRun(event.run, httpStatus);
            if (cause._tag === "Refused") {
              return Effect.fail(new Refusal({ httpStatus: cause.httpStatus }));
            }
            return Effect.sync(() => {
              session.problem = "sourceUnreachable";
            });
          }
          case "Reconnecting":
            session.retries += 1;
            return setState(session, run, "reconnecting");
        }
      };
      return yield* capture
        .run({
          captureId,
          directory,
          url: stream.url,
          ...(stream.userAgent === undefined ? {} : { userAgent: stream.userAgent }),
          ...(stream.headers === undefined ? {} : { headers: stream.headers }),
          ...(options.segmentSeconds === undefined
            ? {}
            : { segmentSeconds: options.segmentSeconds }),
          ...(options.stallTimeoutMs === undefined
            ? {}
            : { stallTimeoutMs: options.stallTimeoutMs }),
          reconnect: reconnectSchedule(reconnect),
        })
        .pipe(
          Stream.runForEach(handle),
          Effect.as<Outcome>({ _tag: "Ended" }),
          Effect.catchTags({
            Refusal: (refusal) =>
              Effect.succeed<Outcome>({ _tag: "Refused", httpStatus: refusal.httpStatus }),
            CaptureFailed: (failed) =>
              Effect.succeed<Outcome>({ _tag: "Failed", lastError: failed.lastError }),
          }),
        );
    });

  /** Keeps a session's capture going until its scope closes. */
  const supervise = (session: Session, wake: PubSub.Subscription<void>) =>
    Effect.gen(function* () {
      while (true) {
        if (session.slot === undefined) {
          const snapshot = yield* lineup.snapshot;
          const now = yield* Clock.currentTimeMillis;
          const claimed = yield* lock.withPermit(claim(session, snapshot, now));
          yield* shutDown(claimed.victims);
          if (claimed.stream === undefined) {
            yield* setUnavailable(session, claimed.reason);
            session.problem ??= claimed.reason;
            const nextCooldown = Math.min(
              ...[...cooldowns.values()]
                .map((cooldown) => cooldown.untilMs)
                .filter((until) => until > now),
            );
            const delay = Math.max(1, Math.min(retryDelayMs, nextCooldown - now));
            yield* Effect.raceFirst(Effect.sleep(delay), PubSub.take(wake));
            continue;
          }
        }
        const stream = session.slot;
        if (stream === undefined) continue;
        const run = yield* newRun(session, stream);
        yield* setState(session, run, "starting");
        const outcome = yield* runStream(session, run);
        yield* lock.withPermit(
          Effect.sync(() => {
            session.slot = undefined;
          }),
        );
        yield* PubSub.publish(streamFreed, undefined);
        if (outcome._tag === "Ended") {
          yield* closeRun(session, "stopped");
          continue;
        }
        const now = yield* Clock.currentTimeMillis;
        const reason: CaptureReason =
          outcome._tag === "Refused" ? "sourceLimit" : "sourceUnreachable";
        session.problem = reason;
        if (outcome._tag === "Failed") {
          yield* closeRun(session, "failed", reason, {
            _tag: "SourceUnreachable",
            message: redacted(stream, outcome.lastError ?? "the source could not be reached"),
          });
        }
        if (outcome._tag === "Refused") {
          yield* PubSub.publish(session.pubsub, {
            _tag: "Refused",
            stream,
            httpStatus: outcome.httpStatus,
          });
          yield* bus.publish({
            _tag: "SourceRefused",
            channelId: session.channelId,
            captureId: run.captureId,
            sourceId: stream.sourceId,
            sourceStreamId: stream.sourceStreamId,
            ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
          });
          yield* closeRun(session, "failed", reason, {
            _tag: "SourceLimitReached",
            ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
          });
          // The provider counts differently than we do (or someone else uses the account):
          // a recording frees one of our lower-ranked streams there and asks again.
          const freed = yield* lock.withPermit(
            Effect.gen(function* () {
              const rank = bestRank(session);
              if (rank !== RANK.recording) return [];
              const victim = victimOn(stream.sourceId, rank);
              return victim === undefined ? [] : [yield* evict(victim, "preempted")];
            }),
          );
          if (freed.length > 0) {
            yield* shutDown(freed);
            yield* Effect.sleep(preemptRetryMs);
            continue;
          }
        }
        cooldowns.set(stream.sourceStreamId, { untilMs: now + cooldownMs, reason });
      }
    });

  const release = (channelId: ChannelId, consumerId: string, entry: Entry) =>
    Effect.gen(function* () {
      const gone = yield* lock.withPermit(
        Effect.sync(() => {
          const session = sessions.get(channelId);
          if (session === undefined || session.consumers.get(consumerId) !== entry) return [];
          session.consumers.delete(consumerId);
          if (session.consumers.size > 0) return [];
          sessions.delete(channelId);
          closing.add(session);
          return [session];
        }),
      );
      yield* shutDown(gone);
    });

  const acquire = (
    channelId: ChannelId,
    consumer: Consumer,
    acquireOptions?: { readonly wait?: boolean },
  ) =>
    Effect.gen(function* () {
      const wait = acquireOptions?.wait ?? consumer.kind === "recording";
      const snapshot = yield* lineup.snapshot;
      const now = yield* Clock.currentTimeMillis;
      const entry: Entry = { consumer, dropped: yield* Deferred.make<CaptureReason>() };
      const joined = yield* lock.withPermit(
        Effect.gen(function* () {
          const existing = sessions.get(channelId);
          if (existing !== undefined) {
            existing.consumers.set(consumer.id, entry);
            return { session: existing, created: false, victims: [] as Array<Session> };
          }
          const session: Session = {
            channelId,
            scope: yield* Scope.fork(managerScope),
            pubsub: yield* PubSub.unbounded<ChannelEvent>(),
            consumers: new Map([[consumer.id, entry]]),
            startedAtMs: now,
            slot: undefined,
            state: "starting",
            announced: undefined,
            sourceIds: new Set(),
            lastSegmentEndMs: undefined,
            problem: undefined,
            retries: 0,
            run: undefined,
          };
          const claimed = yield* claim(session, snapshot, now);
          if (claimed.stream === undefined && !wait) {
            yield* Scope.close(session.scope, Exit.void);
            return yield* new NoStreamAvailable({
              channelId,
              reason: claimed.reason ?? "sourceLimit",
            });
          }
          sessions.set(channelId, session);
          return { session, created: true, victims: claimed.victims };
        }),
      );
      const { session } = joined;
      yield* Scope.addFinalizer(yield* Effect.scope, release(channelId, consumer.id, entry));
      const subscription = yield* PubSub.subscribe(session.pubsub);
      if (joined.created) {
        yield* shutDown(joined.victims);
        const wake = yield* PubSub.subscribe(streamFreed).pipe(Scope.provide(session.scope));
        yield* supervise(session, wake).pipe(Effect.forkIn(session.scope));
      }
      return {
        channelId,
        consumer,
        events: Stream.fromSubscription(subscription),
        status: Effect.sync(() => statusOf(session)),
        dropped: Deferred.await(entry.dropped),
      } satisfies CaptureLease;
    });

  const statusOf = (session: Session): ChannelStatus => ({
    channelId: session.channelId,
    state: session.state,
    stream: session.slot,
    consumers: [...session.consumers.values()].map((entry) => entry.consumer),
    startedAtMs: session.startedAtMs,
    lastSegmentEndMs: session.lastSegmentEndMs,
  });

  return CaptureManager.of({
    acquire,
    status: Effect.sync(() => [...sessions.values()].map(statusOf)),
    liveWindows: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const window = yield* Ref.get(dvrWindow);
      return [...sessions.values()]
        .filter((session) =>
          [...session.consumers.values()].some((entry) => entry.consumer.kind !== "recording"),
        )
        .map((session) => ({
          channelId: session.channelId,
          fromMs: Math.max(session.startedAtMs, now - window),
        }));
    }),
    dvrWindowMs: Ref.get(dvrWindow),
    setDvrWindow: (ms) => Ref.set(dvrWindow, ms),
  });
});
