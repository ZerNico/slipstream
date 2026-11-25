/**
 * Fixtures for the recorder's unit tests: a scripted stand-in for the ffmpeg capture (driven by
 * the TestClock), a line-up, guide entries, rules and the wiring of every service in memory.
 */
import { Capture } from "../src/capture/capture.ts";
import { CaptureFailed } from "../src/capture/errors.ts";
import { type CaptureEvent, type CaptureRun } from "../src/capture/model.ts";
import {
  ChannelId,
  emptyMatcher,
  type Matcher,
  MINUTE,
  type Programme,
  ProgrammeId,
  type Recording,
  RecordingId,
  type Rule,
  RuleId,
  SourceId,
  SourceStreamId,
  UserId,
} from "@slipstream/domain";
import { DateTime, Effect, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { CaptureManager, type CaptureManagerOptions } from "../src/capture-manager.ts";

import {
  makeMemoryGuideRepo,
  makeMemoryHistoryRepo,
  makeMemoryPlanningContextRepo,
  makeMemoryRecordingRepo,
  makeMemoryRuleRepo,
  makeMemorySegmentRepo,
  makeMemoryStorage,
  publishedEventsLayer,
  type MemoryGuideRepo,
  type MemoryHistoryRepo,
  type MemoryPlanningOptions,
  type MemoryRuleRepo,
  type MemoryStorage,
} from "../src/memory.ts";
export { eventsOf } from "../src/memory.ts";
import {
  GuideRepo,
  HistoryRepo,
  Lineup,
  LiveKeepPolicy,
  type LiveKeepRules,
  PlanningContextRepo,
  RecordingRepo,
  RuleRepo,
  SegmentRepo,
  Storage,
  type LineupSnapshot,
  type StreamCandidate,
} from "../src/ports.ts";
import { RetentionPolicies, RetentionSweeper } from "../src/retention.ts";
import { Scheduler, type SchedulerOptions } from "../src/scheduler.ts";

export const timeZone = "Europe/Berlin";

/** Test time starts here (a Sunday, race day). */
export const T0 = Date.parse("2026-11-22T12:00:00Z");

/** An instant `minutes` after T0. */
export const at = (minutes: number) => DateTime.makeUnsafe(T0 + minutes * MINUTE);

export const alice = UserId.make("alice");
export const bob = UserId.make("bob");

export const skyF1 = ChannelId.make("sky-f1");
export const daserste = ChannelId.make("das-erste");
export const prosieben = ChannelId.make("prosieben");
export const arte = ChannelId.make("arte");

export const tvproxy = SourceId.make("tvproxy");
export const backup = SourceId.make("backup");

/** A stream of `channel` on `source`; its URL names both, so the fake capture can script it. */
export const stream = (channel: ChannelId, source: SourceId, priority = 0): StreamCandidate => ({
  sourceStreamId: SourceStreamId.make(`${source}/${channel}`),
  sourceId: source,
  url: `http://${source}.test/${channel}.ts`,
  priority,
});

/** Every channel on tvproxy only, with `maxStreams` (unlimited when omitted). */
export const singleSource = (maxStreams?: number): LineupSnapshot => ({
  channels: [skyF1, daserste, prosieben, arte].map((channelId) => ({
    channelId,
    streams: [stream(channelId, tvproxy)],
  })),
  sources: [maxStreams === undefined ? { id: tvproxy } : { id: tvproxy, maxStreams }],
});

/** Builds a guide entry `from` to `to` minutes after T0. */
export const programme = (
  channelId: ChannelId,
  title: string,
  from: number,
  to: number,
  fields: Partial<Programme> = {},
): Programme => ({
  id: ProgrammeId.make(`${channelId}@${from}`),
  channelId,
  title,
  start: at(from),
  end: at(to),
  categories: [],
  repeat: false,
  live: false,
  ...fields,
});

/** Builds a rule owned by alice. */
export const rule = (id: string, matcher: Partial<Matcher>, fields: Partial<Rule> = {}): Rule => ({
  id: RuleId.make(id),
  name: id,
  enabled: true,
  ownerId: alice,
  matcher: { ...emptyMatcher, ...matcher },
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  retention: { _tag: "KeepAll" },
  skipRepeats: false,
  offerDeclined: false,
  createdAt: at(-60 * 24),
  ...fields,
});

/** A recording as the repository would hold it, on Sky F1 unless told otherwise. */
export const recording = (
  fields: Partial<Recording> & Pick<Recording, "state" | "start" | "end">,
): Recording => ({
  id: RecordingId.make("stored"),
  channelId: skyF1,
  title: "Stored",
  categories: [],
  repeat: false,
  live: false,
  padding: { beforeMinutes: 0, afterMinutes: 0 },
  problems: [],
  ownerIds: [alice],
  protected: false,
  labels: [],
  exportStatus: "none",
  createdAt: at(-120),
  ...fields,
});

/** How the fake upstream behind a URL acts. */
export type Behaviour =
  /** Delivers a 6 s segment every 6 s, for ever. */
  | { readonly _tag: "Live" }
  /** Answers with this HTTP status (403, 429, 509) on every connection. */
  | { readonly _tag: "Refuse"; readonly status: number }
  /** Connection refused on every attempt, until the reconnect schedule gives up. */
  | { readonly _tag: "Down" }
  /** Delivers for `afterMs`, goes silent for `outageMs`, then delivers again. */
  | { readonly _tag: "Drop"; readonly afterMs: number; readonly outageMs: number }
  /**
   * A provider that allows `max` connections across every URL on the same host and answers 509
   * past that, whatever Slipstream believes the limit is.
   */
  | { readonly _tag: "ProviderLimit"; readonly max: number };

/** What the fake capture has done, for assertions. */
export interface CaptureLog {
  /** URLs in the order captures were started on them. */
  readonly started: Array<string>;
  /** Captures running right now, by URL. */
  readonly active: Map<string, number>;
  /** The most captures that ever ran at the same time on one URL. */
  readonly peak: Map<string, number>;
}

const SEGMENT_MS = 6000;

const now = () => Effect.clockWith((clock) => clock.currentTimeMillis);

/**
 * A `Capture` whose upstreams follow scripted behaviours on the TestClock, by URL. URLs without a
 * script behave as `Live`.
 */
export const fakeCapture = (behaviours: Readonly<Record<string, Behaviour>>, log: CaptureLog) =>
  Layer.succeed(
    Capture,
    Capture.of({
      run: (options) =>
        Stream.callback<CaptureEvent, CaptureFailed>((queue) => {
          const emit = (event: CaptureEvent) => Queue.offer(queue, event);
          return Effect.gen(function* () {
            const url = options.url;
            log.started.push(url);
            const running = (log.active.get(url) ?? 0) + 1;
            log.active.set(url, running);
            log.peak.set(url, Math.max(log.peak.get(url) ?? 0, running));
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => log.active.set(url, (log.active.get(url) ?? 1) - 1)),
            );
            const host = new URL(url).host;
            const behaviour = behaviours[url] ?? behaviours[host] ?? { _tag: "Live" };
            // Includes this connection.
            const connectionsOnHost = [...log.active]
              .filter(([other]) => new URL(other).host === host)
              .reduce((sum, [, count]) => sum + count, 0);
            let runIndex = 0;
            let sequence = 0;
            const runRecord = (
              startedAtMs: number,
              segments: number,
              ended: { endedAtMs: number; lastError: string | null } | null,
            ): CaptureRun => ({
              captureId: options.captureId,
              runId: `${options.captureId}-r${runIndex}`,
              runIndex,
              startedAtMs,
              endedAtMs: ended?.endedAtMs ?? null,
              endReason: ended === null ? null : "exited",
              exitCode: ended === null ? null : 8,
              lastError: ended?.lastError ?? null,
              segments,
            });
            const failedRun = (lastError: string, warning?: string) =>
              Effect.gen(function* () {
                runIndex += 1;
                const startedAtMs = yield* now();
                yield* emit({ _tag: "RunStarted", run: runRecord(startedAtMs, 0, null) });
                if (warning !== undefined) {
                  yield* emit({
                    _tag: "Log",
                    runId: `r${runIndex}`,
                    level: "warning",
                    message: warning,
                  });
                }
                yield* emit({
                  _tag: "RunEnded",
                  run: runRecord(startedAtMs, 0, { endedAtMs: startedAtMs + 20, lastError }),
                });
              });
            const deliver = (untilMs: number) =>
              Effect.gen(function* () {
                runIndex += 1;
                const startedAtMs = yield* now();
                const runId = `${options.captureId}-r${runIndex}`;
                yield* emit({ _tag: "RunStarted", run: runRecord(startedAtMs, 0, null) });
                yield* emit({
                  _tag: "StreamDetected",
                  runId,
                  info: { container: "mpegts", bitrate: null, video: [], audio: [] },
                });
                let count = 0;
                while ((yield* now()) + SEGMENT_MS <= untilMs) {
                  const startMs = yield* now();
                  yield* Effect.sleep(SEGMENT_MS);
                  yield* emit({
                    _tag: "SegmentAdded",
                    segment: {
                      captureId: options.captureId,
                      runId,
                      sequence,
                      startMs,
                      durationMs: SEGMENT_MS,
                      bytes: 1000,
                      path: `r${runIndex}-${sequence}.ts`,
                    },
                  });
                  sequence += 1;
                  count += 1;
                  yield* emit({
                    _tag: "Stats",
                    stats: {
                      runId,
                      bitrate: (1000 * 8 * 1000) / SEGMENT_MS,
                      totalBytes: count * 1000,
                      segments: count,
                      mediaMs: count * SEGMENT_MS,
                      speed: 1,
                    },
                  });
                }
                yield* emit({
                  _tag: "RunEnded",
                  run: runRecord(startedAtMs, count, {
                    endedAtMs: yield* now(),
                    lastError: "Connection reset by peer",
                  }),
                });
              });
            const refuse = (status: number) =>
              failedRun(
                `Error opening input files: Server returned ${status >= 500 ? "5XX Server Error reply" : `${status} Forbidden`}`,
                `HTTP error ${status} Refused`,
              ).pipe(
                // A real capture would retry; the manager has to stop it on the refusal.
                Effect.andThen(Effect.never),
              );
            switch (behaviour._tag) {
              case "Live":
                return yield* deliver(Number.POSITIVE_INFINITY);
              case "Refuse":
                return yield* refuse(behaviour.status);
              case "ProviderLimit":
                return connectionsOnHost > behaviour.max
                  ? yield* refuse(509)
                  : yield* deliver(Number.POSITIVE_INFINITY);
              case "Down":
                for (let attempt = 0; attempt < 3; attempt += 1) {
                  yield* failedRun("Error opening input files: Connection refused");
                  yield* Effect.sleep(1000);
                }
                return yield* new CaptureFailed({
                  captureId: options.captureId,
                  attempts: 3,
                  lastError: "Connection refused",
                });
              case "Drop": {
                yield* deliver((yield* now()) + behaviour.afterMs);
                yield* emit({ _tag: "Reconnecting", afterRunId: "", attempt: 1, delayMs: 1000 });
                yield* Effect.sleep(behaviour.outageMs);
                return yield* deliver(Number.POSITIVE_INFINITY);
              }
            }
          });
        }),
    }),
  );

/** A fresh capture log. */
export const makeCaptureLog = (): CaptureLog => ({
  started: [],
  active: new Map(),
  peak: new Map(),
});

const afterYield = <A>(effect: Effect.Effect<A>) => Effect.andThen(Effect.yieldNow, effect);

/** A recording repo that gives way to other fibers before each call. */
const yielding = (repo: RecordingRepo["Service"]): RecordingRepo["Service"] => {
  return RecordingRepo.of({
    list: afterYield(repo.list),
    get: (id) => afterYield(repo.get(id)),
    insert: (stored) => afterYield(repo.insert(stored)),
    update: (id, f) => afterYield(repo.update(id, f)),
    remove: (id) => afterYield(repo.remove(id)),
    addOwners: (id, owners, viaRuleId) => afterYield(repo.addOwners(id, owners, viaRuleId)),
  });
};

/** In-memory ports plus handles to drive them. */
export interface Harness {
  readonly guide: MemoryGuideRepo;
  readonly rules: MemoryRuleRepo;
  readonly storage: MemoryStorage;
  readonly history: MemoryHistoryRepo;
  readonly log: CaptureLog;
}

/**
 * Everything wired in memory around the real manager and scheduler, with the TestClock set to
 * T0. Returns the layer and the handles tests use to change the guide, rules and disk.
 */
export const makeHarness = Effect.fnUntraced(function* (setup: {
  readonly lineup?: LineupSnapshot;
  readonly programmes?: ReadonlyArray<Programme>;
  readonly rules?: ReadonlyArray<Rule>;
  readonly recordings?: ReadonlyArray<Recording>;
  readonly behaviours?: Readonly<Record<string, Behaviour>>;
  readonly freeBytes?: number;
  readonly manager?: Partial<CaptureManagerOptions>;
  readonly scheduler?: Partial<SchedulerOptions>;
  /** Let other fibers run before every recording repo call, as a database round trip does. */
  readonly slowRepo?: boolean;
  /** History, access and conflicts planning sees; everything open by default. */
  readonly planning?: MemoryPlanningOptions;
  /** What live TV keeps after its viewers leave; nothing by default. */
  readonly liveKeep?: LiveKeepRules;
  /** The keep rules cannot be read (the database is in trouble). */
  readonly liveKeepFails?: boolean;
  /** A channel's programme on air cannot be read. */
  readonly guideFails?: boolean;
}) {
  yield* TestClock.setTime(T0);
  const harness: Harness = {
    guide: yield* makeMemoryGuideRepo(setup.programmes),
    rules: yield* makeMemoryRuleRepo(setup.rules),
    storage: yield* makeMemoryStorage({
      freeBytes: setup.freeBytes ?? Number.MAX_SAFE_INTEGER,
      sizeOf: () => 1000,
    }),
    history: yield* makeMemoryHistoryRepo(),
    log: makeCaptureLog(),
  };
  const ports = Layer.mergeAll(
    Layer.succeed(
      GuideRepo,
      setup.guideFails === true
        ? { ...harness.guide, onChannel: () => Effect.die("the guide is gone") }
        : harness.guide,
    ),
    Layer.succeed(RuleRepo, harness.rules),
    Layer.succeed(Storage, harness.storage),
    Layer.succeed(HistoryRepo, harness.history),
    Layer.succeed(PlanningContextRepo, makeMemoryPlanningContextRepo(setup.planning)),
    Layer.effect(
      RecordingRepo,
      makeMemoryRecordingRepo(setup.recordings).pipe(
        Effect.map((repo) => (setup.slowRepo ? yielding(repo) : repo)),
      ),
    ),
    Layer.effect(SegmentRepo, makeMemorySegmentRepo()),
    Lineup.fixed(setup.lineup ?? singleSource()),
    setup.liveKeepFails === true
      ? Layer.succeed(LiveKeepPolicy, { rules: Effect.die("the settings are gone") })
      : setup.liveKeep === undefined
        ? LiveKeepPolicy.none
        : LiveKeepPolicy.fixed(setup.liveKeep),
    publishedEventsLayer,
    fakeCapture(setup.behaviours ?? {}, harness.log),
  );
  const manager = CaptureManager.layer({ root: "/store", ...setup.manager }).pipe(
    Layer.provideMerge(ports),
  );
  const everything = Layer.mergeAll(
    Scheduler.layer({ timeZone, ...setup.scheduler }),
    RetentionSweeper.layer({ timeZone }),
  ).pipe(Layer.provideMerge(RetentionPolicies.fromRules), Layer.provideMerge(manager));
  return { harness, managerLayer: manager, layer: everything };
});

/** Lets forked fibers run up to their next sleep. */
export const settle = Effect.gen(function* () {
  for (let index = 0; index < 50; index += 1) yield* Effect.yieldNow;
});

/** Moves the TestClock forward in steps, letting fibers react in between. */
export const advance = (minutes: number, stepSeconds = 1) =>
  Effect.gen(function* () {
    yield* settle;
    const steps = Math.round((minutes * 60) / stepSeconds);
    for (let index = 0; index < steps; index += 1) {
      yield* TestClock.adjust(stepSeconds * 1000);
      yield* settle;
    }
  });
