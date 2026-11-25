/**
 * Reading recordings with their owners and labels, and the collections that group them.
 */
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { DateTime, Effect } from "effect";
import type { ServerEvent } from "@slipstream/api";
import {
  ChannelId,
  type Collection,
  CollectionId,
  type EpisodeHistoryEntry,
  type FollowedRule,
  ProgrammeId,
  type Recording,
  RecordingId,
  resolveCollections,
  RuleId,
  type StoredCollection,
  UserId,
} from "@slipstream/domain";
import { overlapping } from "../captures/segments.ts";
import type { Database, Transaction } from "../db/client.ts";
import { opt, toInstant } from "../db/codec.ts";
import { addHistory } from "../planning/history.ts";
import {
  captures,
  channels,
  collections,
  recordingDeclines,
  recordingLabels,
  recordingOwners,
  recordings,
  rules,
  segments,
} from "../db/schema.ts";

type RecordingRow = typeof recordings.$inferSelect;

/** A recording plus the server-side fields the API does not carry. */
export interface StoredRecording {
  readonly recording: Recording;
  /** When it was stopped early, epoch ms. */
  readonly stoppedAt: number | undefined;
  /** The moment its grabbed artwork frame shows, epoch ms; absent until one was grabbed. */
  readonly frameAt: number | undefined;
  /** Who left it while others still own it; see the recorder's `StoredRecording`. */
  readonly declinedBy: ReadonlyArray<UserId>;
  /** Owners a series recording added because it left its own airing out (§5.3), by owner. */
  readonly ownersAddedBy: Readonly<Record<UserId, RuleId>>;
}

/** The retained range of a recording in epoch ms: programme times plus padding, cut at a stop. */
export const retainedRange = (
  stored: StoredRecording,
): { readonly startMs: number; readonly endMs: number } => {
  const { recording } = stored;
  const startMs =
    DateTime.toEpochMillis(recording.start) - recording.padding.beforeMinutes * 60_000;
  const paddedEnd = DateTime.toEpochMillis(recording.end) + recording.padding.afterMinutes * 60_000;
  return {
    startMs,
    endMs: stored.stoppedAt === undefined ? paddedEnd : Math.min(paddedEnd, stored.stoppedAt),
  };
};

/**
 * The start of {@link retainedRange} in SQL, over the `recordings` columns. SQLite hands raw
 * expressions back as BigInt; `mapWith(Number)` keeps this and the end the numbers they are
 * typed as (the streams overview takes `Math.max` of the start).
 */
export const retainedStartSql =
  sql<number>`(${recordings.start} - ${recordings.paddingBeforeMinutes} * 60000)`.mapWith(Number);

/** The end of {@link retainedRange} in SQL, over the `recordings` columns. */
export const retainedEndSql =
  sql<number>`min(${recordings.end} + ${recordings.paddingAfterMinutes} * 60000, coalesce(${recordings.stoppedAt}, ${recordings.end} + ${recordings.paddingAfterMinutes} * 60000))`.mapWith(
    Number,
  );

/**
 * Bytes in the segment store inside the retained range of each recording matching `where`, by
 * recording id, in one grouped query; recordings without any segment are absent.
 */
export const recordingSizes = (db: Database | Transaction, where: SQL | undefined) =>
  db
    .select({
      id: recordings.id,
      bytes: sql`coalesce(sum(${segments.bytes}), 0)`.mapWith(Number),
    })
    .from(recordings)
    .innerJoin(captures, eq(captures.channelId, recordings.channelId))
    .innerJoin(
      segments,
      and(
        eq(segments.captureId, captures.id),
        overlapping(recordings.channelId, retainedStartSql, retainedEndSql),
      ),
    )
    .where(where)
    .groupBy(recordings.id)
    .pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.id, row.bytes]))),
      Effect.orDie,
    );

type OwnerRow = typeof recordingOwners.$inferSelect;

/** A recording row with its owners (in the order they came), labels and who left it. */
const toRecording = (
  row: RecordingRow,
  owners: readonly [OwnerRow, ...Array<OwnerRow>],
  labels: ReadonlyArray<string>,
  declinedBy: ReadonlyArray<string>,
): StoredRecording => {
  const ownersAddedBy: Record<UserId, RuleId> = {};
  for (const owner of owners) {
    if (owner.addedByRuleId !== null) {
      ownersAddedBy[UserId.make(owner.userId)] = RuleId.make(owner.addedByRuleId);
    }
  }
  const [first, ...others] = owners;
  return {
    stoppedAt: row.stoppedAt ?? undefined,
    frameAt: row.frameAt ?? undefined,
    declinedBy: declinedBy.map((id) => UserId.make(id)),
    ownersAddedBy,
    recording: {
      id: RecordingId.make(row.id),
      ...opt("programmeId", row.programmeId === null ? null : ProgrammeId.make(row.programmeId)),
      channelId: ChannelId.make(row.channelId),
      start: toInstant(row.start),
      end: toInstant(row.end),
      title: row.title,
      ...opt("subtitle", row.subtitle),
      ...opt("description", row.description),
      categories: row.categories,
      ...opt("episode", row.episode),
      ...opt("originalAirDate", row.originalAirDate),
      repeat: row.repeat,
      live: row.live,
      ...opt("imageUrl", row.imageUrl),
      ...opt("onlineImageUrl", row.onlineImageUrl),
      padding: { beforeMinutes: row.paddingBeforeMinutes, afterMinutes: row.paddingAfterMinutes },
      ...opt("paddingSource", row.paddingSource),
      state: row.state,
      problems: row.problems,
      ...opt("ruleId", row.ruleId === null ? null : RuleId.make(row.ruleId)),
      ownerIds: [UserId.make(first.userId), ...others.map((owner) => UserId.make(owner.userId))],
      protected: row.protected,
      labels,
      ...opt(
        "pinnedCollectionId",
        row.pinnedCollectionId === null ? null : CollectionId.make(row.pinnedCollectionId),
      ),
      exportStatus: row.exportStatus,
      createdAt: toInstant(row.createdAt),
      ...opt("replacesId", row.replacesId === null ? null : RecordingId.make(row.replacesId)),
      ...opt("replacedById", row.replacedById === null ? null : RecordingId.make(row.replacedById)),
      ...opt("hiddenAt", row.hiddenAt === null ? null : toInstant(row.hiddenAt)),
      ...opt("hiddenReason", row.hiddenReason),
      ...opt("rerunOutcome", row.rerunOutcome),
      ...opt("rerunUntil", row.rerunUntil === null ? null : toInstant(row.rerunUntil)),
      ...(row.rerunAttempts === 0 ? {} : { rerunAttempts: row.rerunAttempts }),
    },
  };
};

/** Rows by `key`, in the order they came. */
const groupBy = <A>(rows: ReadonlyArray<A>, key: (row: A) => string) => {
  const map = new Map<string, Array<A>>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list === undefined) map.set(key(row), [row]);
    else list.push(row);
  }
  return map;
};

/**
 * Recordings matching `where` (all when absent), with owners, labels and declines, oldest start
 * first. The related rows are read with `where` as a subquery, so no id list grows with the
 * library. Every recording has an owner (deleting a profile hands its own recordings on); a row
 * without one is a broken invariant and dies.
 */
export const loadRecordings = (db: Database | Transaction, where?: SQL) =>
  Effect.gen(function* () {
    const rows = yield* db.select().from(recordings).where(where).orderBy(recordings.start);
    if (rows.length === 0) return [];
    const of = (column: SQLiteColumn) =>
      where === undefined
        ? undefined
        : inArray(column, db.select({ id: recordings.id }).from(recordings).where(where));
    const owners = yield* db
      .select()
      .from(recordingOwners)
      .where(of(recordingOwners.recordingId))
      .orderBy(recordingOwners.addedAt);
    const labels = yield* db.select().from(recordingLabels).where(of(recordingLabels.recordingId));
    const declines = yield* db
      .select()
      .from(recordingDeclines)
      .where(of(recordingDeclines.recordingId))
      .orderBy(recordingDeclines.declinedAt);
    const ownersById = groupBy(owners, (row) => row.recordingId);
    const labelsById = groupBy(labels, (row) => row.recordingId);
    const declinedById = groupBy(declines, (row) => row.recordingId);
    const result: Array<StoredRecording> = [];
    for (const row of rows) {
      const [first, ...others] = ownersById.get(row.id) ?? [];
      if (first === undefined) {
        return yield* Effect.die(new Error(`recording ${row.id} has no owner`));
      }
      result.push(
        toRecording(
          row,
          [first, ...others],
          (labelsById.get(row.id) ?? []).map((label) => label.label),
          (declinedById.get(row.id) ?? []).map((decline) => decline.userId),
        ),
      );
    }
    return result;
  }).pipe(Effect.orDie);

/** The event that tells a recording's owners it is gone. */
export type RecordingRemoved = Extract<ServerEvent, { readonly _tag: "RecordingRemoved" }>;

/**
 * Deletes a recording with its owners, labels and declines, and writes the episode history rows
 * it leaves (§3.6) in the same transaction. Returns the `RecordingRemoved` event for the owners
 * it had right before, read in the same transaction (once the row is gone nobody can look them
 * up), or `undefined` when there was no such recording.
 */
export const deleteRecording = (
  db: Database,
  recordingId: string,
  history: { readonly entries: ReadonlyArray<EpisodeHistoryEntry>; readonly now: number } = {
    entries: [],
    now: 0,
  },
) =>
  db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* addHistory(tx, history.entries, history.now);
        const owners = yield* tx
          .select({ userId: recordingOwners.userId })
          .from(recordingOwners)
          .where(eq(recordingOwners.recordingId, recordingId))
          .orderBy(recordingOwners.addedAt);
        const deleted = yield* tx
          .delete(recordings)
          .where(eq(recordings.id, recordingId))
          .returning({ id: recordings.id });
        const [first, ...others] = owners.map((row) => UserId.make(row.userId));
        if (deleted.length === 0 || first === undefined) return undefined;
        return {
          _tag: "RecordingRemoved",
          recordingId: RecordingId.make(recordingId),
          ownerIds: [first, ...others],
        } satisfies RecordingRemoved;
      }),
    )
    .pipe(Effect.orDie);

/** One recording, or `undefined`. */
export const loadRecording = (db: Database | Transaction, recordingId: string) =>
  Effect.map(loadRecordings(db, eq(recordings.id, recordingId)), (list) => list[0]);

/**
 * A stored collection, its conditions not resolved yet: its own matcher, or (with `rule_id`) the
 * series recording it follows, the matcher column holding the snapshot (recording model §3.4).
 */
export const toCollection = (row: typeof collections.$inferSelect): StoredCollection => ({
  id: CollectionId.make(row.id),
  name: row.name,
  rank: row.rank,
  labels: row.labels,
  layout: row.layout,
  ...opt("retention", row.retention),
  source:
    row.ruleId === null
      ? { _tag: "Own", matcher: row.matcher }
      : { _tag: "FollowsRule", ruleId: RuleId.make(row.ruleId), snapshot: row.matcher },
});

/** What resolving a linked collection reads from every rule. */
export const loadFollowedRules = (db: Database | Transaction) =>
  db
    .select({
      id: rules.id,
      name: rules.name,
      matcher: rules.matcher,
      collectionId: rules.collectionId,
    })
    .from(rules)
    .pipe(
      Effect.map((rows) =>
        rows.map((row): FollowedRule => ({
          id: RuleId.make(row.id),
          name: row.name,
          matcher: row.matcher,
          ...(row.collectionId === null
            ? {}
            : { collectionId: CollectionId.make(row.collectionId) }),
        })),
      ),
      Effect.orDie,
    );

/** One stored collection row, resolved (`resolveCollections`). */
export const resolveCollection = (
  db: Database | Transaction,
  row: typeof collections.$inferSelect,
) =>
  Effect.flatMap(loadFollowedRules(db), (followed) => {
    // `resolveCollections` maps one to one.
    const [resolved] = resolveCollections([toCollection(row)], followed);
    return resolved === undefined
      ? Effect.die(new Error(`collection ${row.id} did not resolve`))
      : Effect.succeed<Collection>(resolved);
  });

/** Every collection, in ranking order, resolved (`resolveCollections`). */
export const loadCollections = (db: Database | Transaction) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(collections)
      .orderBy(collections.rank, collections.name)
      .pipe(Effect.orDie);
    return resolveCollections(rows.map(toCollection), yield* loadFollowedRules(db));
  });

/** Every channel's name, by id, for group paths and the planner's context. */
export const loadChannelNames = (db: Database | Transaction) =>
  db
    .select({ id: channels.id, name: channels.name })
    .from(channels)
    .pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.id, row.name]))),
      Effect.orDie,
    );

/** Each rule's collection, for the rule step of placement. */
export const loadRuleCollections = (db: Database | Transaction) =>
  db
    .select({ id: rules.id, collectionId: rules.collectionId })
    .from(rules)
    .pipe(
      Effect.map(
        (rows) =>
          new Map(
            rows.flatMap((row) =>
              row.collectionId === null
                ? []
                : [[row.id, CollectionId.make(row.collectionId)] as const],
            ),
          ),
      ),
      Effect.orDie,
    );
