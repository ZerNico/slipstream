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
 *
 * Live TV waits for its viewers (the `LiveKeepPolicy`): when the last live viewer leaves, the
 * channel keeps running for a while (a reload or a short break finds the whole rewind buffer),
 * with no consumer left. Such a lingering capture gives way first: a recording or another
 * channel's viewer that finds no free stream takes its stream. Once a watched capture stopped,
 * its DVR window stays retained for a while as a kept buffer, so a viewer coming back can rewind
 * into it across the gap.
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
  initialLiveKeep,
  keepRunningUntil,
  MINUTE,
  type SourceId,
  type SourceStreamId,
} from "@slipstream/domain";
import {
  Cause,
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
  GuideRepo,
  LiveKeepPolicy,
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
/** The rank of a lingering capture (no consumer left): below everyone, so it gives way first. */
const LINGERING = Number.POSITIVE_INFINITY;

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
  /**
   * Set while the channel keeps running after its last live viewer left: until when. A
   * lingering channel has no consumers and gives its stream to anyone who needs one.
   */
  readonly lingeringUntilMs: number | undefined;
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

/**
 * A live DVR window: segments from `fromMs` on are in use, up to `toMs` for the kept buffer of a
 * capture that stopped (open-ended while the capture runs).
 */
export interface LiveWindow {
  readonly channelId: ChannelId;
  readonly fromMs: number;
  readonly toMs?: number;
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
  /** Where its live DVR window may reach back to: its start, or an earlier kept buffer's. */
  windowFromMs: number;
  /** Until when the channel keeps running for a live viewer who left; unset while none did. */
  lingerUntilMs: number | undefined;
  /**
   * Set by `stopWhenIdle`: the channel stops with its last consumer, lingering for nobody and
   * keeping no buffer. A live viewer joining again clears it.
   */
  stopWhenIdle: boolean;
}

/** What a watched capture left behind when it stopped: its DVR window, kept for a while. */
interface KeptBuffer {
  readonly fromMs: number;
  readonly stoppedAtMs: number;
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

/** The best rank among a session's consumers; {@link LINGERING} without any. */
const bestRank = (session: Session): number =>
  Math.min(LINGERING, ...[...session.consumers.values()].map((entry) => RANK[entry.consumer.kind]));

const hasLiveViewer = (session: Session) =>
  [...session.consumers.values()].some((entry) => entry.consumer.kind !== "recording");

/**
 * Whether the session's DVR window is in use: a live viewer watches, or one left and the
 * channel keeps running for them (also while a recording holds it).
 */
const keepsWindow = (session: Session, now: number) =>
  hasLiveViewer(session) ||
  session.consumers.size === 0 ||
  (session.lingerUntilMs !== undefined && session.lingerUntilMs > now);

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
    /**
     * DVR windows in use, for retention: of channels with live viewers or lingering for one,
     * and the kept buffers of watched captures that stopped, each within the DVR window.
     */
    readonly liveWindows: Effect.Effect<ReadonlyArray<LiveWindow>>;
    readonly dvrWindowMs: Effect.Effect<number>;
    /** Shrinks (or restores) the DVR window, e.g. when disk space runs low. */
    setDvrWindow(ms: number): Effect.Effect<void>;
    /** Lets every kept buffer go (disk space runs low); the next sweep deletes their segments. */
    readonly dropBuffers: Effect.Effect<void>;
    /**
     * The channel's capture stops with its last consumer, lingering for nobody: at once when
     * it has none (an admin stopped it).
     */
    stopWhenIdle(channelId: ChannelId): Effect.Effect<void>;
  }
>()("@slipstream/recorder/CaptureManager") {
  /** The manager; closing the layer stops every capture. */
  static readonly layer = (options: CaptureManagerOptions) =>
    Layer.effect(CaptureManager, makeCaptureManager(options));
}

/**
 * `read`, or `fallback` (logged) when it fails: the keep rules and the guide are database
 * reads, and trouble there must never stop the capture bookkeeping (a consumer released, a
 * window kept). Interruption still interrupts.
 */
const orElse = <A>(read: Effect.Effect<A>, fallback: A, what: string) =>
  read.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning(`Could not read ${what}; going on without it`, cause).pipe(
            Effect.as(fallback),
          ),
    ),
  );

const makeCaptureManager = Effect.fnUntraced(function* (options: CaptureManagerOptions) {
  const capture = yield* Capture;
  const lineup = yield* Lineup;
  const segments = yield* SegmentRepo;
  const bus = yield* RecorderEvents;
  const guide = yield* GuideRepo;
  const keepPolicy = yield* LiveKeepPolicy;
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
  /** The kept buffer of each channel whose watched capture stopped. */
  const buffers = new Map<ChannelId, KeptBuffer>();
  let captureCounter = 0;

  /** The live keep rules; the defaults when they cannot be read. */
  const keepRules = orElse(keepPolicy.rules, initialLiveKeep, "the live keep rules");

  const keepBufferMs = Effect.map(keepRules, (rules) => rules.keepBufferMinutes * MINUTE);

  /** When a channel whose live viewer left at `now` stops, by the keep rules and the guide. */
  const lingerDeadline = (channelId: ChannelId, now: number) =>
    Effect.gen(function* () {
      const { keepRunning } = yield* keepRules;
      if (keepRunning !== "programmeEnd") return keepRunningUntil(keepRunning, now, undefined);
      const instant = DateTime.makeUnsafe(now);
      const onChannel = yield* orElse(
        guide.onChannel(channelId, { start: instant, end: instant }),
        [],
        "the programme on air",
      );
      const onAir = onChannel.find(
        (programme) =>
          DateTime.toEpochMillis(programme.start) <= now &&
          now < DateTime.toEpochMillis(programme.end),
      );
      return keepRunningUntil(
        keepRunning,
        now,
        onAir === undefined ? undefined : DateTime.toEpochMillis(onAir.end),
      );
    });

  /**
   * Takes a session out of the active set (call under the lock); with `keepBuffer` its DVR
   * window stays retained as the channel's kept buffer. Shut it down with {@link shutDown}.
   */
  const retire = (session: Session, now: number, keepBuffer: boolean) => {
    sessions.delete(session.channelId);
    closing.add(session);
    if (keepBuffer) {
      buffers.set(session.channelId, { fromMs: session.windowFromMs, stoppedAtMs: now });
    }
  };

  /**
   * A live viewer's linger that ended while others (a recording) keep the capture running: the
   * DVR window it kept becomes the channel's kept buffer, as if the capture had stopped when the
   * linger ended. Call under the lock.
   */
  const settleLinger = (session: Session, now: number) => {
    const until = session.lingerUntilMs;
    if (until === undefined || until > now) return;
    if (session.consumers.size === 0 || hasLiveViewer(session)) return;
    session.lingerUntilMs = undefined;
    buffers.set(session.channelId, { fromMs: session.windowFromMs, stoppedAtMs: until });
  };

  /**
   * A live viewer joins: the channel's kept buffer (if still kept) becomes part of the
   * session's DVR window again. Call under the lock.
   */
  const absorbBuffer = (session: Session, now: number, keptMs: number) => {
    const buffer = buffers.get(session.channelId);
    if (buffer === undefined) return;
    buffers.delete(session.channelId);
    if (buffer.stoppedAtMs + keptMs > now) {
      session.windowFromMs = Math.min(session.windowFromMs, buffer.fromMs);
    }
  };

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
  const evict = (victim: Session, reason: CaptureReason, now: number) =>
    Effect.gen(function* () {
      settleLinger(victim, now);
      retire(victim, now, keepsWindow(victim, now) && !victim.stopWhenIdle);
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
      // A recording takes the stream of a channel only live viewers use; anyone takes the
      // stream of a lingering channel (the worst-ranked victim comes first).
      const rank = bestRank(session);
      for (const stream of usable) {
        const victim = victimOn(stream.sourceId, rank);
        if (victim === undefined) continue;
        if (rank !== RANK.recording && bestRank(victim) !== LINGERING) continue;
        const evicted = yield* evict(victim, "preempted", now);
        session.slot = stream;
        return { stream, victims: [evicted], reason: undefined };
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
          const now = yield* Clock.currentTimeMillis;
          // A lingering channel that lost its stream stops instead of asking for another.
          const stopped = yield* lock.withPermit(
            Effect.sync(() => {
              if (session.consumers.size > 0 || sessions.get(session.channelId) !== session) {
                return false;
              }
              retire(session, now, !session.stopWhenIdle);
              return true;
            }),
          );
          if (stopped) {
            // Its own scope is closed from outside, which ends this loop.
            yield* shutDown([session]).pipe(Effect.forkIn(managerScope));
            return;
          }
          const snapshot = yield* lineup.snapshot;
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
          // a recording frees one of our lower-ranked streams there and asks again, a viewer
          // one of a lingering channel.
          const freed = yield* lock.withPermit(
            Effect.gen(function* () {
              const rank = bestRank(session);
              const victim = victimOn(stream.sourceId, rank);
              if (victim === undefined) return [];
              if (rank !== RANK.recording && bestRank(victim) !== LINGERING) return [];
              return [yield* evict(victim, "preempted", now)];
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

  /** Stops `session` once its linger is over, unless someone joined it meanwhile. */
  const endLinger = (session: Session) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const gone = yield* lock.withPermit(
        Effect.sync(() => {
          if (sessions.get(session.channelId) !== session || session.consumers.size > 0) return [];
          if (session.lingerUntilMs !== undefined && session.lingerUntilMs > now) return [];
          retire(session, now, !session.stopWhenIdle);
          return [session];
        }),
      );
      yield* shutDown(gone);
    });

  /** Lets the session linger until its deadline, then stops it (unless someone joined). */
  const linger = (session: Session, untilMs: number, now: number) =>
    Effect.sleep(Math.max(0, untilMs - now)).pipe(
      Effect.andThen(endLinger(session)),
      // The session's own scope closes when it stops, so the wait lives with the manager.
      Effect.forkIn(managerScope),
    );

  const release = (channelId: ChannelId, consumerId: string, entry: Entry) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const live = entry.consumer.kind !== "recording";
      // Read outside the lock: the guide is a database query.
      const deadline = live ? yield* lingerDeadline(channelId, now) : undefined;
      const outcome = yield* lock.withPermit(
        Effect.sync(
          (): {
            readonly lingering?: { readonly session: Session; readonly untilMs: number };
            readonly gone?: Session;
          } => {
            const session = sessions.get(channelId);
            if (session === undefined || session.consumers.get(consumerId) !== entry) return {};
            settleLinger(session, now);
            session.consumers.delete(consumerId);
            if (deadline !== undefined && deadline > now && !session.stopWhenIdle) {
              session.lingerUntilMs = Math.max(session.lingerUntilMs ?? 0, deadline);
            }
            if (session.consumers.size > 0) return {};
            if (session.lingerUntilMs !== undefined && session.lingerUntilMs > now) {
              return { lingering: { session, untilMs: session.lingerUntilMs } };
            }
            // An admin stopped it to free the stream: nothing of it is kept.
            retire(session, now, live && !session.stopWhenIdle);
            return { gone: session };
          },
        ),
      );
      if (outcome.lingering !== undefined) {
        yield* linger(outcome.lingering.session, outcome.lingering.untilMs, now);
      }
      if (outcome.gone !== undefined) yield* shutDown([outcome.gone]);
    });

  const stopWhenIdle = (channelId: ChannelId) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const gone = yield* lock.withPermit(
        Effect.sync(() => {
          const session = sessions.get(channelId);
          if (session === undefined) return [];
          session.stopWhenIdle = true;
          session.lingerUntilMs = undefined;
          if (session.consumers.size > 0) return [];
          // Stopped by hand to free the stream: its rewind buffer goes too.
          retire(session, now, false);
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
      const live = consumer.kind !== "recording";
      const snapshot = yield* lineup.snapshot;
      const now = yield* Clock.currentTimeMillis;
      const keptMs = live ? yield* keepBufferMs : 0;
      const entry: Entry = { consumer, dropped: yield* Deferred.make<CaptureReason>() };
      const joined = yield* lock.withPermit(
        Effect.gen(function* () {
          const existing = sessions.get(channelId);
          if (existing !== undefined) {
            settleLinger(existing, now);
            existing.consumers.set(consumer.id, entry);
            if (live) {
              // Back in time: the channel no longer lingers, and its kept buffer is its again.
              // Someone watches again, so an admin's stop no longer applies.
              existing.lingerUntilMs = undefined;
              existing.stopWhenIdle = false;
              absorbBuffer(existing, now, keptMs);
            }
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
            windowFromMs: now,
            lingerUntilMs: undefined,
            stopWhenIdle: false,
          };
          const claimed = yield* claim(session, snapshot, now);
          if (claimed.stream === undefined && !wait) {
            yield* Scope.close(session.scope, Exit.void);
            return yield* new NoStreamAvailable({
              channelId,
              reason: claimed.reason ?? "sourceLimit",
            });
          }
          if (live) absorbBuffer(session, now, keptMs);
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
    lingeringUntilMs: session.consumers.size === 0 ? session.lingerUntilMs : undefined,
  });

  return CaptureManager.of({
    acquire,
    status: Effect.sync(() => [...sessions.values()].map(statusOf)),
    liveWindows: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const window = yield* Ref.get(dvrWindow);
      const keptMs = yield* keepBufferMs;
      return yield* lock.withPermit(
        Effect.sync(() => {
          for (const session of sessions.values()) settleLinger(session, now);
          const running = [...sessions.values()]
            .filter((session) => keepsWindow(session, now))
            .map((session): LiveWindow => ({
              channelId: session.channelId,
              fromMs: Math.max(session.windowFromMs, now - window),
            }));
          for (const [channelId, buffer] of buffers) {
            if (buffer.stoppedAtMs + keptMs <= now) buffers.delete(channelId);
          }
          const kept = [...buffers].map(([channelId, buffer]): LiveWindow => ({
            channelId,
            fromMs: Math.max(buffer.fromMs, now - window),
            toMs: buffer.stoppedAtMs,
          }));
          return [...running, ...kept];
        }),
      );
    }),
    dvrWindowMs: Ref.get(dvrWindow),
    setDvrWindow: (ms) => Ref.set(dvrWindow, ms),
    dropBuffers: lock.withPermit(Effect.sync(() => buffers.clear())),
    stopWhenIdle,
  });
});
