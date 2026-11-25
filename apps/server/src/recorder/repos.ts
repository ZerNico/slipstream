/**
 * `@slipstream/recorder`'s ports over SQLite and the server's services: recordings with their
 * owners and labels, the segment index (which also opens `captures` rows), the guide
 * with a change stream, rules, the channel line-up with opened source secrets, and retention
 * policies that follow collection placement.
 */
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { Clock, Effect, Layer, Stream } from "effect";
import type { RetentionCandidate } from "@slipstream/api";
import { redactSecrets, streamRequestHeaders, streamSecrets } from "@slipstream/sources";
import {
  applyRetention,
  CaptureId,
  ChannelId,
  type Collection,
  epochMs,
  eventOf,
  governingRetention,
  placeInCollection,
  type Recording,
  type RecordingId,
  RecordingId as RecordingIdSchema,
  type Rule,
  SourceId,
  SourceStreamId,
} from "@slipstream/domain";
import {
  type NewCapture,
  expiredRecordings,
  GuideRepo,
  HistoryRepo,
  Lineup,
  PlanningContextRepo,
  RecordingRepo,
  type RetentionGroup,
  RetentionPolicies,
  RuleRepo,
  SegmentRepo,
  type StoredRecording,
  type StoredSegment,
  type StreamCandidate,
} from "@slipstream/recorder";
import { ServerConfig } from "../config.ts";
import { overlapping } from "../captures/segments.ts";
import { Db, type Transaction } from "../db/client.ts";
import { chunks } from "../db/codec.ts";
import {
  captures,
  channelStreams,
  recordingDeclines,
  recordingLabels,
  recordingOwners,
  recordings,
  rules,
  segments,
  sources,
  sourceStreams,
} from "../db/schema.ts";
import { EventBus } from "../events.ts";
import { Guide } from "../guide/service.ts";
import { addHistory } from "../planning/history.ts";
import { Planning } from "../planning/service.ts";
import { deleteRecording, loadCollections, loadRecordings } from "../recordings/store.ts";
import { toRule } from "../rules/store.ts";
import { streamRequest } from "../sources/mapping.ts";
import { SecretBox } from "../sources/secret-box.ts";
import { openStreamUrl, sourceFromRow } from "../sources/store.ts";

/** The columns of a recording row, from the domain value. */
const recordingColumns = (recording: Recording) => ({
  programmeId: recording.programmeId ?? null,
  channelId: recording.channelId,
  start: epochMs(recording.start),
  end: epochMs(recording.end),
  title: recording.title,
  subtitle: recording.subtitle ?? null,
  description: recording.description ?? null,
  categories: recording.categories,
  episode: recording.episode ?? null,
  originalAirDate: recording.originalAirDate ?? null,
  repeat: recording.repeat,
  live: recording.live,
  imageUrl: recording.imageUrl ?? null,
  onlineImageUrl: recording.onlineImageUrl ?? null,
  paddingBeforeMinutes: recording.padding.beforeMinutes,
  paddingAfterMinutes: recording.padding.afterMinutes,
  paddingSource: recording.paddingSource ?? null,
  state: recording.state,
  problems: recording.problems,
  ruleId: recording.ruleId ?? null,
  protected: recording.protected,
  pinnedCollectionId: recording.pinnedCollectionId ?? null,
  exportStatus: recording.exportStatus,
  replacesId: recording.replacesId ?? null,
  replacedById: recording.replacedById ?? null,
  hiddenAt: recording.hiddenAt === undefined ? null : epochMs(recording.hiddenAt),
  hiddenReason: recording.hiddenReason ?? null,
  rerunOutcome: recording.rerunOutcome ?? null,
  rerunUntil: recording.rerunUntil === undefined ? null : epochMs(recording.rerunUntil),
  rerunAttempts: recording.rerunAttempts ?? 0,
});

/** Rows whose user is none of `userIds`: every row when the list is empty. */
const notAmong = (column: SQLiteColumn, userIds: ReadonlyArray<string>) =>
  userIds.length === 0
    ? undefined
    : sql`${column} NOT IN (${sql.join(
        userIds.map((id) => sql`${id}`),
        sql`, `,
      )})`;

/** Writes owners (in order), declines and labels so they equal the recording's. */
const syncOwnersAndLabels = (tx: Transaction, recording: StoredRecording, now: number) =>
  Effect.gen(function* () {
    yield* tx
      .delete(recordingOwners)
      .where(
        and(
          eq(recordingOwners.recordingId, recording.id),
          notAmong(recordingOwners.userId, recording.ownerIds),
        ),
      );
    // New owners only; an owner keeps the rule that added it, if any.
    yield* tx
      .insert(recordingOwners)
      .values(
        recording.ownerIds.map((userId, index) => ({
          recordingId: recording.id,
          userId,
          addedAt: now + index,
          addedByRuleId: recording.ownersAddedBy?.[userId] ?? null,
        })),
      )
      .onConflictDoNothing();
    yield* tx
      .delete(recordingDeclines)
      .where(
        and(
          eq(recordingDeclines.recordingId, recording.id),
          notAmong(recordingDeclines.userId, recording.declinedBy),
        ),
      );
    if (recording.declinedBy.length > 0) {
      yield* tx
        .insert(recordingDeclines)
        .values(
          recording.declinedBy.map((userId) => ({
            recordingId: recording.id,
            userId,
            declinedAt: now,
          })),
        )
        .onConflictDoNothing();
    }
    yield* tx.delete(recordingLabels).where(eq(recordingLabels.recordingId, recording.id));
    const labels = [...new Set(recording.labels)];
    if (labels.length > 0) {
      yield* tx
        .insert(recordingLabels)
        .values(labels.map((label) => ({ recordingId: recording.id, label })));
    }
  });

/** A loaded recording as the recorder sees it: with the people who left it. */
const forRecorder = (stored: {
  readonly recording: Recording;
  readonly declinedBy: StoredRecording["declinedBy"];
  readonly ownersAddedBy: NonNullable<StoredRecording["ownersAddedBy"]>;
}): StoredRecording => ({
  ...stored.recording,
  declinedBy: stored.declinedBy,
  ownersAddedBy: stored.ownersAddedBy,
});

/**
 * Recordings in SQLite. State changes go out as `RecordingChanged` events, a removal as
 * `RecordingRemoved` to the owners it had.
 */
export const RecordingRepoLive = Layer.effect(
  RecordingRepo,
  Effect.gen(function* () {
    const { write, read } = yield* Db;
    const bus = yield* EventBus;
    const changed = (recording: Recording) =>
      bus.publish({ _tag: "RecordingChanged", recordingId: recording.id, state: recording.state });
    return RecordingRepo.of({
      list: Effect.map(loadRecordings(read), (stored) => stored.map(forRecorder)),
      get: (id) =>
        Effect.map(loadRecordings(read, eq(recordings.id, id)), (stored) =>
          stored[0] === undefined ? undefined : forRecorder(stored[0]),
        ),
      insert: (recording) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* write
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* tx.insert(recordings).values({
                  id: recording.id,
                  ...recordingColumns(recording),
                  stoppedAt: null,
                  createdAt: epochMs(recording.createdAt),
                });
                yield* syncOwnersAndLabels(tx, recording, now);
              }),
            )
            .pipe(Effect.orDie);
          yield* changed(recording);
        }),
      update: (id, f) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const result = yield* write
            .transaction((tx) =>
              Effect.gen(function* () {
                const [current] = yield* loadRecordings(tx, eq(recordings.id, id));
                if (current === undefined) return undefined;
                const next = f(forRecorder(current));
                yield* tx
                  .update(recordings)
                  .set(recordingColumns(next))
                  .where(eq(recordings.id, id));
                yield* syncOwnersAndLabels(tx, next, now);
                return { before: current.recording.state, next };
              }),
            )
            .pipe(Effect.orDie);
          if (result === undefined) return undefined;
          if (result.before !== result.next.state) yield* changed(result.next);
          return result.next;
        }),
      remove: (id) =>
        Effect.gen(function* () {
          const removed = yield* deleteRecording(write, id);
          if (removed !== undefined) yield* bus.publish(removed);
        }),
      // Owners a series recording adds because it left its own airing out (§5.3), with the rule
      // that added them, so Undo after "Record series" can take back exactly these.
      addOwners: (id, owners, viaRuleId) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          return yield* write
            .transaction((tx) =>
              Effect.gen(function* () {
                const [current] = yield* loadRecordings(tx, eq(recordings.id, id));
                if (current === undefined) return undefined;
                const recording = forRecorder(current);
                const added = [...new Set(owners)].filter(
                  (owner) =>
                    !recording.ownerIds.includes(owner) && !recording.declinedBy.includes(owner),
                );
                if (added.length === 0) return recording;
                const [firstOwner, ...otherOwners] = recording.ownerIds;
                const addedBy = { ...recording.ownersAddedBy };
                for (const owner of added) addedBy[owner] = viaRuleId;
                const next: StoredRecording = {
                  ...recording,
                  ownerIds: [firstOwner, ...otherOwners, ...added],
                  ownersAddedBy: addedBy,
                };
                yield* syncOwnersAndLabels(tx, next, now);
                return next;
              }),
            )
            .pipe(Effect.orDie);
        }),
    });
  }),
);

/**
 * The planning context (recording model §5.2): the episode history, the household's access
 * policies and the stream limits, from the same `Planning` service the preview, guide repeats
 * and record options use.
 */
export const PlanningContextRepoLive = Layer.effect(
  PlanningContextRepo,
  Effect.map(Planning, (planning) => PlanningContextRepo.of({ context: () => planning.access })),
);

/** The episode history in `episode_history` (§3.6): retention writes it for good episodes. */
export const HistoryRepoLive = Layer.effect(
  HistoryRepo,
  Effect.gen(function* () {
    const { write } = yield* Db;
    return HistoryRepo.of({
      add: (entries) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          addHistory(write, entries, now).pipe(Effect.orDie),
        ),
    });
  }),
);

type SegmentRow = { readonly segment: typeof segments.$inferSelect } & {
  readonly channelId: string;
  readonly directory: string;
};

const toStoredSegment = (row: SegmentRow): StoredSegment => ({
  captureId: row.segment.captureId,
  runId: row.segment.runId,
  sequence: row.segment.sequence,
  startMs: row.segment.startMs,
  durationMs: row.segment.durationMs,
  bytes: row.segment.bytes,
  path: row.segment.path,
  channelId: ChannelId.make(row.channelId),
  directory: row.directory,
});

const SEGMENT_DELETE_BATCH = 400;

/**
 * The segment index in SQLite. A capture run's `captures` row opens before the run starts (and
 * closes the channel's previous one); every segment adds to the row's counters. A write that
 * fails is logged, never fatal: the capture keeps running and the file stays on disk.
 */
export const SegmentRepoLive = Layer.effect(
  SegmentRepo,
  Effect.gen(function* () {
    const { write, read } = yield* Db;
    const bus = yield* EventBus;

    const selectSegments = (where: SQL | undefined) =>
      read
        .select({ segment: segments, channelId: captures.channelId, directory: captures.directory })
        .from(segments)
        .innerJoin(captures, eq(captures.id, segments.captureId))
        .where(where)
        .orderBy(asc(segments.startMs), asc(segments.sequence))
        .pipe(
          Effect.map((rows) => rows.map(toStoredSegment)),
          Effect.orDie,
        );

    /**
     * Opens the row of a new capture run, closing the channel's open ones in the same
     * transaction. A row that cannot be written is logged: the capture runs anyway, and its
     * segments then fail to index (loudly) instead of opening a row of their own.
     */
    const openCapture = (run: NewCapture) =>
      Effect.gen(function* () {
        const closed = yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              const ended = yield* tx
                .update(captures)
                .set({ state: "stopped", endedAt: run.startedAtMs })
                .where(and(eq(captures.channelId, run.channelId), isNull(captures.endedAt)))
                .returning({ id: captures.id });
              yield* tx.insert(captures).values({
                id: run.captureId,
                channelId: run.channelId,
                sourceStreamId: run.sourceStreamId,
                startedAt: run.startedAtMs,
                state: "starting",
                stats: { bytes: 0, segments: 0, reconnects: 0 },
                directory: run.directory,
              });
              return ended;
            }),
          )
          .pipe(Effect.orDie);
        for (const row of closed) {
          yield* bus.publish({
            _tag: "CaptureChanged",
            captureId: CaptureId.make(row.id),
            channelId: run.channelId,
            state: "stopped",
          });
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Could not record a capture run", cause).pipe(
            Effect.annotateLogs({ captureId: run.captureId, channelId: run.channelId }),
          ),
        ),
      );

    const add = (segment: StoredSegment) =>
      Effect.gen(function* () {
        yield* write
          .insert(segments)
          .values({
            captureId: segment.captureId,
            sequence: segment.sequence,
            runId: segment.runId,
            startMs: segment.startMs,
            durationMs: segment.durationMs,
            bytes: segment.bytes,
            path: segment.path,
          })
          .onConflictDoNothing();
        const bitrateKbps =
          segment.durationMs > 0 ? Math.round((segment.bytes * 8) / segment.durationMs) : 0;
        yield* write
          .update(captures)
          .set({
            state: "running",
            stats: sql`json_set(${captures.stats}, '$.bytes', json_extract(${captures.stats}, '$.bytes') + ${segment.bytes}, '$.segments', json_extract(${captures.stats}, '$.segments') + 1, '$.bitrateKbps', ${bitrateKbps})`,
          })
          .where(eq(captures.id, segment.captureId));
        yield* bus.publishSegmentIndexed(segment.channelId);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Could not index a segment", cause).pipe(
            Effect.annotateLogs({ captureId: segment.captureId, sequence: segment.sequence }),
          ),
        ),
      );

    return SegmentRepo.of({
      openCapture,
      add,
      forChannel: (channelId, fromMs, toMs) => selectSegments(overlapping(channelId, fromMs, toMs)),
      list: selectSegments(undefined),
      remove: (doomed) =>
        Effect.gen(function* () {
          for (const batch of chunks(doomed, SEGMENT_DELETE_BATCH)) {
            yield* write
              .delete(segments)
              .where(
                or(
                  ...batch.map((segment) =>
                    and(
                      eq(segments.captureId, segment.captureId),
                      eq(segments.sequence, segment.sequence),
                    ),
                  ),
                ),
              );
          }
          // Finished captures without any segment left are history nobody can play.
          yield* write.delete(captures).where(
            and(
              isNotNull(captures.endedAt),
              notExists(
                write
                  .select({ one: sql`1` })
                  .from(segments)
                  .where(eq(segments.captureId, captures.id)),
              ),
            ),
          );
        }).pipe(Effect.orDie),
    });
  }),
);

/** The guide as the scheduler reads it; `changes` follows guide refreshes. */
export const GuideRepoLive = Layer.effect(
  GuideRepo,
  Effect.gen(function* () {
    const guide = yield* Guide;
    const bus = yield* EventBus;
    return GuideRepo.of({
      programmes: (range) => guide.between(epochMs(range.start), epochMs(range.end)),
      programme: (id) =>
        guide.programme(id).pipe(Effect.catchTag("NotFound", () => Effect.succeed(undefined))),
      changes: bus.events.pipe(
        Stream.filter((event) => event._tag === "GuideRefreshed"),
        Stream.map(() => undefined),
      ),
    });
  }),
);

/**
 * Rules as the scheduler reads them. Edits reach the scheduler through `Recorder.replan`, so
 * there is no separate change stream.
 */
export const RuleRepoLive = Layer.effect(
  RuleRepo,
  Effect.gen(function* () {
    const { read } = yield* Db;
    return RuleRepo.of({
      list: read
        .select()
        .from(rules)
        .pipe(
          Effect.map((rows) => rows.map(toRule)),
          Effect.orDie,
        ),
      changes: Stream.empty,
    });
  }),
);

/**
 * Channels with their source streams (stream URLs and secrets opened) and the sources' stream
 * limits. A stream gets the source's secret headers only on the source's own origin (see
 * `streamRequestHeaders`), and a redactor for its credentials, so ffmpeg's lines about it can be
 * stored and shown. ffmpeg takes the URL and headers on its command line, which other local
 * users can read (`ps`); run the server under its own user on a machine you trust.
 */
export const LineupLive = Layer.effect(
  Lineup,
  Effect.gen(function* () {
    const { read } = yield* Db;
    const box = yield* SecretBox;
    return Lineup.of({
      snapshot: Effect.gen(function* () {
        const sourceRows = yield* read
          .select()
          .from(sources)
          .where(eq(sources.enabled, true))
          .pipe(Effect.orDie);
        const opened = yield* Effect.forEach(sourceRows, (row) => sourceFromRow(box, row));
        const byId = new Map(opened.map((source) => [source.id as string, source]));
        const links = yield* read
          .select({
            channelId: channelStreams.channelId,
            priority: channelStreams.priority,
            sourceStreamId: sourceStreams.id,
            sourceId: sourceStreams.sourceId,
            url: sourceStreams.url,
            userAgent: sourceStreams.userAgent,
            referrer: sourceStreams.referrer,
          })
          .from(channelStreams)
          .innerJoin(sourceStreams, eq(sourceStreams.id, channelStreams.sourceStreamId))
          .where(
            inArray(
              sourceStreams.sourceId,
              opened.map((source) => source.id),
            ),
          )
          .pipe(Effect.orDie);
        const channels = new Map<string, Array<StreamCandidate>>();
        for (const link of links) {
          const source = byId.get(link.sourceId);
          if (source === undefined) continue;
          const url = yield* openStreamUrl(box, link.url);
          const request = streamRequest(source.userAgent, streamRequestHeaders(source, url), link);
          const secrets = streamSecrets(source, url);
          channels.set(link.channelId, [
            ...(channels.get(link.channelId) ?? []),
            {
              sourceStreamId: SourceStreamId.make(link.sourceStreamId),
              sourceId: SourceId.make(link.sourceId),
              url,
              priority: link.priority,
              ...request,
              redact: (text: string) => redactSecrets(text, secrets),
            },
          ]);
        }
        return {
          channels: [...channels].map(([channelId, streams]) => ({
            channelId: ChannelId.make(channelId),
            streams,
          })),
          sources: opened.map((source) => ({
            id: source.id,
            ...(source.maxStreams === undefined ? {} : { maxStreams: source.maxStreams }),
          })),
        };
      }),
    });
  }),
);

/** A retention group plus whose policy it is, for the retention preview. */
interface PolicyGroup extends RetentionGroup {
  readonly from: RetentionCandidate["policyFrom"];
}

/**
 * The retention policy of each recording (PLAN 6.6): the collection's when the collection it is
 * placed in sets one, otherwise its rule's; recordings with neither are kept. `KeepNewestEvents`
 * groups by the collection layout's event part.
 */
export const retentionGroups = (
  all: ReadonlyArray<Recording>,
  collections: ReadonlyArray<Collection>,
  ruleList: ReadonlyArray<Rule>,
  timeZone: string,
): Array<PolicyGroup> => {
  const rulesById = new Map(ruleList.map((rule) => [rule.id as string, rule]));
  const members = new Map<string, Array<RecordingId>>();
  const add = (key: string, id: RecordingId) => members.set(key, [...(members.get(key) ?? []), id]);
  for (const recording of all) {
    const rule = recording.ruleId === undefined ? undefined : rulesById.get(recording.ruleId);
    const placement = placeInCollection(collections, recording, {
      timeZone,
      ruleCollectionId: rule?.collectionId,
    });
    const from = governingRetention(placement?.collection, rule)?.from;
    if (from?._tag === "Collection") add(`collection:${from.collectionId}`, recording.id);
    else if (from?._tag === "Rule") add(`rule:${from.ruleId}`, recording.id);
  }
  const groups: Array<PolicyGroup> = [];
  for (const collection of collections) {
    const id = `collection:${collection.id}`;
    const recordingIds = members.get(id);
    if (collection.retention === undefined || recordingIds === undefined) continue;
    groups.push({
      id,
      retention: collection.retention,
      recordingIds,
      eventOf: (recording) => eventOf(collection, recording, timeZone),
      from: { _tag: "Collection", collectionId: collection.id },
    });
  }
  for (const rule of ruleList) {
    const id = `rule:${rule.id}`;
    const recordingIds = members.get(id);
    if (recordingIds === undefined) continue;
    groups.push({
      id,
      retention: rule.retention,
      recordingIds,
      from: { _tag: "Rule", ruleId: rule.id },
    });
  }
  return groups;
};

/**
 * What the next retention run deletes, and why. The set is the recorder's own verdict, which
 * applies the domain's `applyRetention` per group; the reason is that verdict's for the first
 * group that holds the recording.
 */
export const retentionCandidates = (
  all: ReadonlyArray<Recording>,
  groups: ReadonlyArray<PolicyGroup>,
  nowMs: number,
): Array<RetentionCandidate> => {
  const expired = expiredRecordings(all, groups, nowMs);
  const byId = new Map(all.map((recording) => [recording.id as string, recording]));
  return groups.flatMap((group) => {
    const items = group.recordingIds.flatMap((id) => {
      const recording = byId.get(id);
      return recording === undefined ? [] : [{ ...recording, event: group.eventOf?.(recording) }];
    });
    const verdict = applyRetention(group.retention, items, nowMs);
    return items.flatMap((item): Array<RetentionCandidate> => {
      if (!expired.has(item.id)) return [];
      expired.delete(item.id);
      // Expired means every group, this one included, lets it go, so this verdict has a reason.
      const reason = verdict.remove.find((entry) => entry.item.id === item.id)?.reason;
      return reason === undefined
        ? []
        : [{ recordingId: RecordingIdSchema.make(item.id), reason, policyFrom: group.from }];
    });
  });
};

/** Retention policies from collections and rules in the database. */
export const RetentionPoliciesLive = Layer.effect(
  RetentionPolicies,
  Effect.gen(function* () {
    const { read } = yield* Db;
    const config = yield* ServerConfig;
    const ruleRepo = yield* RuleRepo;
    return RetentionPolicies.of({
      groups: (all) =>
        Effect.gen(function* () {
          const collections = yield* loadCollections(read);
          return retentionGroups(all, collections, yield* ruleRepo.list, config.timeZone);
        }),
    });
  }),
);
