/**
 * In-memory implementations of the recorder's ports, for tests and as a reference for the
 * server's SQLite adapters. Each `make*` returns the port service plus a few test controls.
 */
import {
  type EpisodeHistoryEntry,
  overlaps,
  type Programme,
  type Recording,
  type RecordingId,
  type Rule,
} from "@slipstream/domain";
import { Context, Effect, Layer, PubSub, Ref, Stream } from "effect";
import { RecorderEvents, type RecorderEvent } from "./events.ts";
import {
  GuideRepo,
  HistoryRepo,
  type PlanningAccess,
  PlanningContextRepo,
  RecordingRepo,
  RuleRepo,
  SegmentRepo,
  Storage,
  StorageFailed,
  type StoredRecording,
  type StoredSegment,
} from "./ports.ts";

/** A recording repository backed by a map. Initial recordings nobody declined may omit `declinedBy`. */
export const makeMemoryRecordingRepo = (
  initial: ReadonlyArray<Recording & Partial<Pick<StoredRecording, "declinedBy">>> = [],
): Effect.Effect<RecordingRepo["Service"]> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyMap<RecordingId, StoredRecording>>(
      new Map(
        initial.map((recording) => [
          recording.id,
          { ...recording, declinedBy: recording.declinedBy ?? [] },
        ]),
      ),
    );
    return RecordingRepo.of({
      list: Effect.map(Ref.get(ref), (map) => [...map.values()]),
      get: (id) => Effect.map(Ref.get(ref), (map) => map.get(id)),
      insert: (recording) => Ref.update(ref, (map) => new Map(map).set(recording.id, recording)),
      update: (id, f) =>
        Ref.modify(
          ref,
          (
            map,
          ): readonly [StoredRecording | undefined, ReadonlyMap<RecordingId, StoredRecording>] => {
            const current = map.get(id);
            if (current === undefined) return [undefined, map];
            const next = f(current);
            return [next, new Map(map).set(id, next)];
          },
        ),
      remove: (id) =>
        Ref.update(ref, (map) => {
          const next = new Map(map);
          next.delete(id);
          return next;
        }),
      addOwners: (id, owners, viaRuleId) =>
        Ref.modify(
          ref,
          (
            map,
          ): readonly [StoredRecording | undefined, ReadonlyMap<RecordingId, StoredRecording>] => {
            const current = map.get(id);
            if (current === undefined) return [undefined, map];
            const added = owners.filter(
              (owner, index) =>
                !current.ownerIds.includes(owner) &&
                !current.declinedBy.includes(owner) &&
                owners.indexOf(owner) === index,
            );
            if (added.length === 0) return [current, map];
            const addedBy = { ...current.ownersAddedBy };
            for (const owner of added) addedBy[owner] = viaRuleId;
            const next: StoredRecording = {
              ...current,
              ownerIds: [...current.ownerIds, ...added] as StoredRecording["ownerIds"],
              ownersAddedBy: addedBy,
            };
            return [next, new Map(map).set(id, next)];
          },
        ),
    });
  });

/** History held in memory, with what was written so far for tests. */
export type MemoryHistoryRepo = HistoryRepo["Service"] & {
  readonly entries: Effect.Effect<ReadonlyArray<EpisodeHistoryEntry>>;
};

/** An episode history backed by a list. */
export const makeMemoryHistoryRepo = (
  initial: ReadonlyArray<EpisodeHistoryEntry> = [],
): Effect.Effect<MemoryHistoryRepo> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(initial);
    return {
      ...HistoryRepo.of({ add: (entries) => Ref.update(ref, (rows) => [...rows, ...entries]) }),
      entries: Ref.get(ref),
    };
  });

/** What a memory planning context starts with; everything open when left out. */
export interface MemoryPlanningOptions {
  /** Read on every `context` call, so a test can change it between plans. */
  readonly history?: Effect.Effect<ReadonlyArray<EpisodeHistoryEntry>> | undefined;
  readonly sees?: PlanningAccess["sees"] | undefined;
  readonly seesChannel?: PlanningAccess["seesChannel"] | undefined;
  readonly unserved?: PlanningAccess["unserved"] | undefined;
  readonly channelNames?: Readonly<Record<string, string>> | undefined;
}

/**
 * A planning context for tests: every person sees every recording and channel, the sources serve
 * everything, and history comes from `history` (empty by default), unless told otherwise.
 */
export const makeMemoryPlanningContextRepo = (
  options: MemoryPlanningOptions = {},
): PlanningContextRepo["Service"] =>
  PlanningContextRepo.of({
    context: () =>
      Effect.map(options.history ?? Effect.succeed([]), (history) => ({
        history,
        sees: options.sees ?? (() => true),
        seesChannel: options.seesChannel ?? (() => true),
        unserved: options.unserved ?? (() => new Set()),
        channelName: (channelId) => options.channelNames?.[channelId],
      })),
  });

const segmentKey = (segment: StoredSegment) => `${segment.captureId}#${segment.sequence}`;

const sorted = (segments: Iterable<StoredSegment>) =>
  [...segments].toSorted((a, b) => a.startMs - b.startMs || a.sequence - b.sequence);

/** A segment index backed by a map keyed by capture id and sequence. */
export const makeMemorySegmentRepo = (): Effect.Effect<SegmentRepo["Service"]> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyMap<string, StoredSegment>>(new Map());
    return SegmentRepo.of({
      openCapture: () => Effect.void,
      add: (segment) => Ref.update(ref, (map) => new Map(map).set(segmentKey(segment), segment)),
      forChannel: (channelId, fromMs, toMs) =>
        Effect.map(Ref.get(ref), (map) =>
          sorted(
            [...map.values()].filter(
              (segment) =>
                segment.channelId === channelId &&
                segment.startMs < toMs &&
                fromMs < segment.startMs + segment.durationMs,
            ),
          ),
        ),
      list: Effect.map(Ref.get(ref), (map) => sorted(map.values())),
      remove: (segments) =>
        Ref.update(ref, (map) => {
          const next = new Map(map);
          for (const segment of segments) next.delete(segmentKey(segment));
          return next;
        }),
    });
  });

/** A guide held in memory, with `replace` to simulate a guide refresh. */
export type MemoryGuideRepo = GuideRepo["Service"] & {
  replace(programmes: ReadonlyArray<Programme>): Effect.Effect<void>;
};

/** A guide repository over a fixed list of programmes. */
export const makeMemoryGuideRepo = (
  initial: ReadonlyArray<Programme> = [],
): Effect.Effect<MemoryGuideRepo> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(initial);
    const changed = yield* PubSub.unbounded<void>();
    return {
      ...GuideRepo.of({
        programmes: (range) =>
          Effect.map(Ref.get(ref), (programmes) =>
            programmes.filter((programme) => overlaps(programme, range)),
          ),
        programme: (id) =>
          Effect.map(Ref.get(ref), (programmes) =>
            programmes.find((programme) => programme.id === id),
          ),
        changes: Stream.fromPubSub(changed),
      }),
      replace: (programmes) =>
        Ref.set(ref, programmes).pipe(
          Effect.andThen(PubSub.publish(changed, undefined)),
          Effect.asVoid,
        ),
    };
  });

/** Rules held in memory, with `replace` to simulate an edit. */
export type MemoryRuleRepo = RuleRepo["Service"] & {
  replace(rules: ReadonlyArray<Rule>): Effect.Effect<void>;
};

/** A rule repository over a fixed list of rules. */
export const makeMemoryRuleRepo = (
  initial: ReadonlyArray<Rule> = [],
): Effect.Effect<MemoryRuleRepo> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(initial);
    const changed = yield* PubSub.unbounded<void>();
    return {
      ...RuleRepo.of({ list: Ref.get(ref), changes: Stream.fromPubSub(changed) }),
      replace: (rules) =>
        Ref.set(ref, rules).pipe(Effect.andThen(PubSub.publish(changed, undefined)), Effect.asVoid),
    };
  });

/** A simulated disk: free space is a number, deleting a file gives its size back. */
export type MemoryStorage = Storage["Service"] & {
  setFreeBytes(bytes: number): Effect.Effect<void>;
  /** Makes deleting `path` fail (`refused: true`), as a read-only or busy mount does, or work again. */
  setRefused(path: string, refused: boolean): Effect.Effect<void>;
  /** Paths removed so far, in order. */
  readonly removed: Effect.Effect<ReadonlyArray<string>>;
};

/** A simulated disk with `freeBytes` free; `sizeOf` tells how much a removed file frees. */
export const makeMemoryStorage = (options: {
  readonly freeBytes: number;
  readonly sizeOf?: (path: string) => number;
}): Effect.Effect<MemoryStorage> =>
  Effect.gen(function* () {
    const free = yield* Ref.make(options.freeBytes);
    const removed = yield* Ref.make<ReadonlyArray<string>>([]);
    const refused = yield* Ref.make<ReadonlySet<string>>(new Set());
    return {
      ...Storage.of({
        freeBytes: Ref.get(free),
        removeFile: (path) =>
          Effect.gen(function* () {
            if ((yield* Ref.get(refused)).has(path)) {
              return yield* new StorageFailed({ path, message: "EACCES: permission denied" });
            }
            yield* Ref.update(removed, (paths) => [...paths, path]);
            yield* Ref.update(free, (bytes) => bytes + (options.sizeOf?.(path) ?? 0));
          }),
      }),
      setFreeBytes: (bytes) => Ref.set(free, bytes),
      setRefused: (path, refuse) =>
        Ref.update(refused, (paths) => {
          const next = new Set(paths);
          if (refuse) next.add(path);
          else next.delete(path);
          return next;
        }),
      removed: Ref.get(removed),
    };
  });

/** Everything a test or a first server cut needs, in memory: repos, guide, rules and a disk. */
export const memoryLayer = (
  options: {
    readonly programmes?: ReadonlyArray<Programme>;
    readonly rules?: ReadonlyArray<Rule>;
    readonly recordings?: ReadonlyArray<Recording>;
    readonly freeBytes?: number;
    readonly planning?: MemoryPlanningOptions;
  } = {},
) =>
  Layer.mergeAll(
    Layer.effect(RecordingRepo, makeMemoryRecordingRepo(options.recordings)),
    Layer.effect(HistoryRepo, makeMemoryHistoryRepo()),
    Layer.succeed(PlanningContextRepo, makeMemoryPlanningContextRepo(options.planning)),
    Layer.effect(SegmentRepo, makeMemorySegmentRepo()),
    Layer.effect(GuideRepo, makeMemoryGuideRepo(options.programmes)),
    Layer.effect(RuleRepo, makeMemoryRuleRepo(options.rules)),
    Layer.effect(
      Storage,
      makeMemoryStorage({ freeBytes: options.freeBytes ?? Number.MAX_SAFE_INTEGER }),
    ),
  );

/** Every event the recorder published so far, oldest first. */
export class PublishedEvents extends Context.Service<
  PublishedEvents,
  { readonly all: Effect.Effect<ReadonlyArray<RecorderEvent>> }
>()("@slipstream/recorder/testing/PublishedEvents") {}

/**
 * The real event bus, also remembering everything it publishes for {@link PublishedEvents}, so
 * a test can look at what happened without having subscribed before it happened.
 */
export const publishedEventsLayer = Layer.unwrap(
  Effect.map(Ref.make<ReadonlyArray<RecorderEvent>>([]), (published) =>
    Layer.merge(
      Layer.effect(
        RecorderEvents,
        Effect.map(RecorderEvents, (bus) =>
          RecorderEvents.of({
            ...bus,
            publish: (event) =>
              Ref.update(published, (events) => [...events, event]).pipe(
                Effect.andThen(bus.publish(event)),
              ),
          }),
        ),
      ).pipe(Layer.provide(RecorderEvents.layer)),
      Layer.succeed(PublishedEvents, PublishedEvents.of({ all: Ref.get(published) })),
    ),
  ),
);

/** Published events of one kind so far. */
export const eventsOf = <Tag extends RecorderEvent["_tag"]>(tag: Tag) =>
  Effect.map(
    Effect.flatMap(PublishedEvents, (events) => events.all),
    (all) =>
      all.filter((event): event is Extract<RecorderEvent, { _tag: Tag }> => event._tag === tag),
  );
