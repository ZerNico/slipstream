/**
 * What the recorder needs from the rest of the server, as narrow ports. The server adapts them
 * to SQLite and its source/channel tables; `memory.ts` has in-memory versions for tests.
 */
import { statfs, rm } from "node:fs/promises";
import { type Segment } from "./capture/model.ts";
import type {
  CaptureId,
  ChannelId,
  EpisodeHistoryEntry,
  EpisodeRecording,
  Programme,
  ProgrammeId,
  Recording,
  RecordingId,
  Rule,
  RuleId,
  SourceId,
  SourceLimit,
  SourceStreamId,
  TimeRange,
  UserId,
} from "@slipstream/domain";
import { Context, Effect, Layer, Schedule, Schema, type Stream } from "effect";

/** A capture segment as the recorder stores it: which channel it shows and where it lives. */
export interface StoredSegment extends Segment {
  readonly channelId: ChannelId;
  /** Absolute directory of its capture; `path` is relative to it. */
  readonly directory: string;
}

/**
 * A recording as the recorder keeps it: the domain recording plus the people who left it while
 * others still own it. Planning their rules never makes them owners again; asking to record the
 * programme themselves does, and ends the decline. Nobody is both an owner and declined.
 */
export interface StoredRecording extends Recording {
  readonly declinedBy: ReadonlyArray<UserId>;
  /**
   * Owners a series recording added because it left its own airing out as a repeat of this one
   * (recording model §5.3), by owner: Undo after "Record series" takes back exactly these.
   */
  readonly ownersAddedBy?: Readonly<Record<UserId, RuleId>> | undefined;
}

/** Recordings, scheduled, running and finished. */
export class RecordingRepo extends Context.Service<
  RecordingRepo,
  {
    readonly list: Effect.Effect<ReadonlyArray<StoredRecording>>;
    get(id: RecordingId): Effect.Effect<StoredRecording | undefined>;
    insert(recording: StoredRecording): Effect.Effect<void>;
    /** Applies `f` atomically; returns the new value, or `undefined` when the id is unknown. */
    update(
      id: RecordingId,
      f: (recording: StoredRecording) => StoredRecording,
    ): Effect.Effect<StoredRecording | undefined>;
    remove(id: RecordingId): Effect.Effect<void>;
    /**
     * Adds owners to a recording because the series recording `viaRuleId` left its own airing out
     * as a repeat of it (§5.3), remembering the rule per added owner. Owners it already has and
     * people who left it (`declinedBy`) are skipped. Returns the new value, or `undefined` when
     * the id is unknown.
     */
    addOwners(
      id: RecordingId,
      owners: ReadonlyArray<UserId>,
      viaRuleId: RuleId,
    ): Effect.Effect<StoredRecording | undefined>;
  }
>()("@slipstream/recorder/RecordingRepo") {}

/** A planned or scheduled item, for asking whether the sources can serve it. */
export interface ServiceCandidate {
  /** A recording id, or a programme id for an item only planned so far. */
  readonly id: string;
  readonly channelId: ChannelId;
  /** The padded range it would record. */
  readonly range: TimeRange;
}

/**
 * Everything planning needs beyond rules, guide and recordings (§5.2): who had which episode,
 * who may see what, and which items the current conflict result cannot serve.
 */
export interface PlanningAccess {
  /** Deleted episodes, every owner's. */
  readonly history: ReadonlyArray<EpisodeHistoryEntry>;
  /** Whether a person may see a recording (`seesRecording`). */
  readonly sees: (ownerId: UserId, recording: EpisodeRecording) => boolean;
  /** Whether a person may see a channel. */
  readonly seesChannel: (ownerId: UserId, channelId: ChannelId) => boolean;
  /** The ids of the items the sources cannot serve together, from the conflict detection. */
  readonly unserved: (items: ReadonlyArray<ServiceCandidate>) => ReadonlySet<string>;
  /** Channel names, so a sub-title naming the channel never identifies an episode. */
  readonly channelName: (channelId: ChannelId) => string | undefined;
}

/** The planning context, read once per plan. */
export class PlanningContextRepo extends Context.Service<
  PlanningContextRepo,
  {
    /** The context as of `now` (epoch ms). */
    context(now: number): Effect.Effect<PlanningAccess>;
  }
>()("@slipstream/recorder/PlanningContextRepo") {}

/** The episode history (§3.6): deleted good episodes, so they are not recorded again. */
export class HistoryRepo extends Context.Service<
  HistoryRepo,
  {
    /** Writes one row per entry. */
    add(entries: ReadonlyArray<EpisodeHistoryEntry>): Effect.Effect<void>;
  }
>()("@slipstream/recorder/HistoryRepo") {}

/** A capture run as the segment index records it, before its first segment. */
export interface NewCapture {
  readonly captureId: CaptureId;
  readonly channelId: ChannelId;
  /** Absolute directory its segments are written to. */
  readonly directory: string;
  readonly sourceStreamId: SourceStreamId;
  readonly startedAtMs: number;
}

/** The segment index. Adding the same capture id and sequence twice keeps one entry. */
export class SegmentRepo extends Context.Service<
  SegmentRepo,
  {
    /**
     * Records a new capture run of a channel, before it starts and so before any of its
     * segments; the channel's earlier runs still recorded as open end here (a new run
     * supersedes them). The capture manager is its only caller.
     */
    openCapture(run: NewCapture): Effect.Effect<void>;
    /** Indexes a segment of a capture run opened with `openCapture`. */
    add(segment: StoredSegment): Effect.Effect<void>;
    /** Segments of a channel overlapping `[fromMs, toMs)`, ordered by start. */
    forChannel(
      channelId: ChannelId,
      fromMs: number,
      toMs: number,
    ): Effect.Effect<ReadonlyArray<StoredSegment>>;
    readonly list: Effect.Effect<ReadonlyArray<StoredSegment>>;
    remove(segments: ReadonlyArray<StoredSegment>): Effect.Effect<void>;
  }
>()("@slipstream/recorder/SegmentRepo") {}

/** Guide data. `changes` emits after every refresh. */
export class GuideRepo extends Context.Service<
  GuideRepo,
  {
    /** Programmes overlapping `range`. */
    programmes(range: TimeRange): Effect.Effect<ReadonlyArray<Programme>>;
    programme(id: ProgrammeId): Effect.Effect<Programme | undefined>;
    readonly changes: Stream.Stream<void>;
  }
>()("@slipstream/recorder/GuideRepo") {}

/** Recording rules. `changes` emits after every edit. */
export class RuleRepo extends Context.Service<
  RuleRepo,
  {
    readonly list: Effect.Effect<ReadonlyArray<Rule>>;
    readonly changes: Stream.Stream<void>;
  }
>()("@slipstream/recorder/RuleRepo") {}

/** One way to receive a channel: a source stream with what it takes to connect. */
export interface StreamCandidate {
  readonly sourceStreamId: SourceStreamId;
  readonly sourceId: SourceId;
  readonly url: string;
  /** Lower is tried first. */
  readonly priority: number;
  readonly userAgent?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /**
   * Redacts this stream's credentials (in its URL, or configured for its source) from text
   * ffmpeg printed about it. Applied to every log line and error before it is emitted.
   */
  readonly redact?: ((text: string) => string) | undefined;
}

/** The streams of one channel. */
export interface ChannelLineup {
  readonly channelId: ChannelId;
  readonly streams: ReadonlyArray<StreamCandidate>;
}

/** Channels with their source streams, and the sources' concurrent stream limits. */
export interface LineupSnapshot {
  readonly channels: ReadonlyArray<ChannelLineup>;
  readonly sources: ReadonlyArray<SourceLimit>;
}

/** Where channels come from: the curated channel layer over the sources. */
export class Lineup extends Context.Service<
  Lineup,
  {
    readonly snapshot: Effect.Effect<LineupSnapshot>;
  }
>()("@slipstream/recorder/Lineup") {
  /** A fixed line-up, for tests and single-source setups. */
  static readonly fixed = (snapshot: LineupSnapshot) =>
    Layer.succeed(Lineup, Lineup.of({ snapshot: Effect.succeed(snapshot) }));
}

/** The streams of a channel in fallback order (lowest priority number first). */
export const streamsOf = (
  snapshot: LineupSnapshot,
  channelId: ChannelId,
): ReadonlyArray<StreamCandidate> =>
  (snapshot.channels.find((channel) => channel.channelId === channelId)?.streams ?? []).toSorted(
    (a, b) => a.priority - b.priority,
  );

/** The segment store's file system did not answer: a file not deleted, or no free space read. */
export class StorageFailed extends Schema.TaggedError<StorageFailed>()("StorageFailed", {
  path: Schema.String,
  message: Schema.String,
}) {}

/** A short wait and two more tries: a busy disk or network mount often answers the next time. */
const storageRetry = { schedule: Schedule.exponential("100 millis"), times: 2 };

/** The segment store's disk. */
export class Storage extends Context.Service<
  Storage,
  {
    /** Bytes available to the server process on the segment store's file system. */
    readonly freeBytes: Effect.Effect<number, StorageFailed>;
    /** Deletes a file; a missing file is not an error (it is gone either way). */
    removeFile(path: string): Effect.Effect<void, StorageFailed>;
  }
>()("@slipstream/recorder/Storage") {
  /** The local file system holding `root`. */
  static readonly node = (root: string) =>
    Layer.succeed(
      Storage,
      Storage.of({
        freeBytes: Effect.tryPromise({
          try: async () => {
            const stats = await statfs(root);
            return stats.bavail * stats.bsize;
          },
          catch: (error) => new StorageFailed({ path: root, message: String(error) }),
        }).pipe(Effect.retry(storageRetry)),
        removeFile: (path) =>
          // `force` ignores only a missing file (ENOENT); anything else (permissions, a busy or
          // read-only mount) fails, so the caller keeps the file's index entry.
          Effect.tryPromise({
            try: () => rm(path, { force: true }),
            catch: (error) => new StorageFailed({ path, message: String(error) }),
          }).pipe(Effect.retry(storageRetry)),
      }),
    );
}
