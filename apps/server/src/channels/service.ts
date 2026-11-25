/**
 * Channels (PLAN 6.2): the curated list people see. Everyone reads it (a restricted profile or
 * guest only its own channels); admins edit names, numbers, logos, guide mapping, visibility and
 * the fallback order of streams, and remove, merge and split channels.
 *
 * Numbers are fixed: a number belongs to its channel, the lineup is ordered by it and gaps are
 * fine. Taking a number another channel holds moves that one to the next free number above.
 *
 * Removing a channel never deletes it: recordings and captures cascade on the row. A removed
 * channel (`removedAt`) is out of every list, the guide, playback and planning; its streams go
 * back to their source's pool and its recordings keep its name. One-off recordings still
 * scheduled on it are cancelled first: they would start with no stream.
 */
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import {
  type ChannelInput,
  type ChannelReview,
  type ChannelStreamInput,
  type ChannelUpdate,
  type GuideChannelView,
  InvalidInput,
  NotFound,
} from "@slipstream/api";
import {
  ChannelId,
  channelPairKey,
  type ChannelStream,
  ChannelStreamId,
  dedupeNumbers,
  guideChannelOrder,
  guideSuggestions,
  importNumber,
  type Matcher,
  type MatchReason,
  mergeSuggestions,
  type NumberChange,
  placeNumbers,
  RecordingId,
  SourceId,
  SourceStreamId,
  type User,
} from "@slipstream/domain";
import { requireAdmin } from "../auth/service.ts";
import { Db, type Transaction } from "../db/client.ts";
import { opt } from "../db/codec.ts";
import {
  captures,
  channels,
  channelsApart,
  channelStreams,
  collections,
  episodeHistory,
  guideChannels,
  programmes,
  recordings,
  rules,
  sources,
  sourceStreams,
  users,
} from "../db/schema.ts";
import { loadViewer, requireChannel, seesChannel } from "../household/viewer.ts";
import { newId } from "../ids.ts";
import { Recorder } from "../recorder/engine.ts";
import { parseChannelNumber } from "../sources/mapping.ts";
import { Sources } from "../sources/service.ts";
import { liveChannel, loadGuideIcons, takenNumbers, toChannel } from "./lineup.ts";

type ChannelRow = typeof channels.$inferSelect;

const toChannelStream = (row: typeof channelStreams.$inferSelect): ChannelStream => ({
  id: ChannelStreamId.make(row.id),
  channelId: ChannelId.make(row.channelId),
  sourceStreamId: SourceStreamId.make(row.sourceStreamId),
  priority: row.priority,
});

/** A matcher with `from` channel ids replaced by `to`, each once; unchanged when none is in it. */
const remapMatcher = (matcher: Matcher, from: ReadonlySet<string>, to: ChannelId): Matcher =>
  matcher.channels.some((id) => from.has(id))
    ? {
        ...matcher,
        channels: [...new Set(matcher.channels.map((id) => (from.has(id) ? to : id)))],
      }
    : matcher;

/** Whether a matcher names one of `ids`. */
const namesAny = (matcher: Matcher, ids: ReadonlySet<string>) =>
  matcher.channels.some((id) => ids.has(id));

const SEARCH_LIMIT = 50;

/** Escapes `%`, `_` and `\` for a LIKE pattern with `ESCAPE '\'`. */
const likeTerm = (term: string) => `%${term.replaceAll(/[%_\\]/g, (c) => `\\${c}`)}%`;

/** Every pair of `ids` once, as `channels_apart` stores it (the smaller id first). */
const apartRows = (ids: ReadonlyArray<string>, now: number) =>
  ids.flatMap((a, index) =>
    ids.slice(index + 1).map((b) => ({
      channelA: a < b ? a : b,
      channelB: a < b ? b : a,
      createdAt: now,
    })),
  );

/** Writes number changes inside a transaction. */
const applyNumbers = (tx: Transaction, changes: ReadonlyArray<NumberChange>) =>
  Effect.forEach(
    changes,
    (change) =>
      tx.update(channels).set({ number: change.number }).where(eq(channels.id, change.id)),
    { discard: true },
  );

/** The live lineup as numbering sees it, read inside the transaction. */
const numbering = (tx: Transaction) =>
  tx
    .select({ id: channels.id, name: channels.name, number: channels.number })
    .from(channels)
    .where(liveChannel)
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: ChannelId.make(row.id),
          name: row.name,
          ...opt("number", row.number),
        })),
      ),
    );

/** Gives `ids` the numbers from `start` on, moving holders up (see `placeNumbers`). */
const placeIn = (tx: Transaction, ids: ReadonlyArray<ChannelId>, start: number) =>
  Effect.gen(function* () {
    yield* applyNumbers(tx, placeNumbers(yield* numbering(tx), ids, start));
  });

/**
 * Soft-removes channels inside a transaction: `removedAt` set, stream links dropped so the
 * streams return to their sources' pools. Recordings, captures, history and rules stay.
 */
const softRemove = (
  tx: Transaction,
  ids: ReadonlyArray<string>,
  now: number,
  mergedInto: string | null,
) =>
  Effect.gen(function* () {
    if (ids.length === 0) return;
    yield* tx.delete(channelStreams).where(inArray(channelStreams.channelId, [...ids]));
    yield* tx
      .update(channels)
      .set({ removedAt: now, mergedInto })
      .where(inArray(channels.id, [...ids]));
  });

const makeChannels = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const sourcesService = yield* Sources;
  const recorder = yield* Recorder;

  /** A live channel's row; a removed one is `NotFound` like one that never was. */
  const findRow = (channelId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read
        .select()
        .from(channels)
        .where(and(eq(channels.id, channelId), liveChannel))
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "channel", id: channelId });
      return row;
    });

  const liveRows = read.select().from(channels).where(liveChannel).pipe(Effect.orDie);

  const lineup = Effect.gen(function* () {
    const icons = yield* loadGuideIcons(read);
    return (yield* liveRows).map((row) => toChannel(row, icons)).toSorted(guideChannelOrder);
  });

  const streamsOf = (channelId: string) =>
    read
      .select()
      .from(channelStreams)
      .where(eq(channelStreams.channelId, channelId))
      .orderBy(asc(channelStreams.priority))
      .pipe(
        Effect.map((rows) => rows.map(toChannelStream)),
        Effect.orDie,
      );

  /** Unknown, removed and repeated ids among `ids`, as input problems under `path`. */
  const checkIds = (ids: ReadonlyArray<string>, path: string) =>
    Effect.gen(function* () {
      const known = new Set(
        (yield* read
          .select({ id: channels.id })
          .from(channels)
          .where(and(inArray(channels.id, [...ids]), liveChannel))
          .pipe(Effect.orDie)).map((row) => row.id),
      );
      const seen = new Set<string>();
      for (const [index, id] of ids.entries()) {
        if (!known.has(id)) return yield* new NotFound({ entity: "channel", id });
        if (seen.has(id)) {
          return yield* new InvalidInput({
            problems: [{ path: `${path}.${index}`, code: "duplicate" }],
          });
        }
        seen.add(id);
      }
    });

  /** Keep and the others of a merge, checked: all live, none twice, keep not among them. */
  const mergeParties = (keepId: string, otherIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      yield* checkIds([keepId, ...otherIds], "ids");
      const rows = yield* read
        .select()
        .from(channels)
        .where(inArray(channels.id, [keepId, ...otherIds]))
        .pipe(Effect.orDie);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const keep = byId.get(keepId);
      if (keep === undefined) return yield* new NotFound({ entity: "channel", id: keepId });
      const others = otherIds.flatMap((id) => byId.get(id) ?? []);
      return { keep, others };
    });

  /** Rules and collections whose matcher names one of `ids`. */
  const matchersNaming = (ids: ReadonlySet<string>) =>
    Effect.gen(function* () {
      const ruleRows = yield* read
        .select({ id: rules.id, matcher: rules.matcher })
        .from(rules)
        .pipe(Effect.orDie);
      const collectionRows = yield* read
        .select({ id: collections.id, matcher: collections.matcher })
        .from(collections)
        .pipe(Effect.orDie);
      return {
        rules: ruleRows.filter((row) => namesAny(row.matcher, ids)),
        collections: collectionRows.filter((row) => namesAny(row.matcher, ids)),
      };
    });

  /** How many live channels each guide channel id is mapped to. */
  const mappedCounts = read
    .select({ id: channels.guideChannelId, count: sql<number | bigint>`count(*)` })
    .from(channels)
    .where(and(liveChannel, sql`${channels.guideChannelId} IS NOT NULL`))
    .groupBy(channels.guideChannelId)
    .pipe(
      Effect.map(
        (rows) =>
          new Map(rows.flatMap((row) => (row.id === null ? [] : [[row.id, Number(row.count)]]))),
      ),
      Effect.orDie,
    );

  /** The title on now for each of `xmltvIds` that the guide has something on for. */
  const onNow = (xmltvIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (xmltvIds.length === 0) return new Map<string, string>();
      const now = yield* Clock.currentTimeMillis;
      const rows = yield* read
        .select({ id: programmes.guideChannelId, title: programmes.title })
        .from(programmes)
        .where(
          and(
            inArray(programmes.guideChannelId, [...new Set(xmltvIds)]),
            lte(programmes.start, now),
            gt(programmes.end, now),
          ),
        )
        .pipe(Effect.orDie);
      const titles = new Map<string, string>();
      for (const row of rows) if (!titles.has(row.id)) titles.set(row.id, row.title);
      return titles;
    });

  /** Guide channel rows as the mapping lists show them, with what is on now. */
  const guideViews = (
    rows: ReadonlyArray<{
      readonly guide: typeof guideChannels.$inferSelect;
      readonly reason?: MatchReason;
    }>,
  ) =>
    Effect.gen(function* () {
      const mapped = yield* mappedCounts;
      const titles = yield* onNow(rows.map((row) => row.guide.xmltvId));
      return rows.map((row): GuideChannelView => ({
        ...guideView(row.guide, mapped),
        ...opt("reason", row.reason ?? null),
        ...opt("now", titles.get(row.guide.xmltvId) ?? null),
      }));
    });

  /**
   * One-off recordings still scheduled on `ids`. They would start with no stream to record
   * from, so removing the channel cancels them; series recordings just stop matching it.
   */
  const scheduledOneOffs = (ids: ReadonlyArray<string>) =>
    read
      .select({ id: recordings.id })
      .from(recordings)
      .where(
        and(
          inArray(recordings.channelId, [...ids]),
          eq(recordings.state, "scheduled"),
          isNull(recordings.ruleId),
          isNull(recordings.hiddenAt),
        ),
      )
      .pipe(Effect.orDie);

  /** Cancels the scheduled one-offs on `ids`, then soft-removes the channels. */
  const removeChannels = (ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      for (const { id } of yield* scheduledOneOffs(ids)) {
        yield* recorder.stopAndSettle(RecordingId.make(id));
      }
      const now = yield* Clock.currentTimeMillis;
      yield* write.transaction((tx) => softRemove(tx, ids, now, null)).pipe(Effect.orDie);
    });

  // Lineups from before numbers were unique: later duplicates move to the next free number.
  yield* write
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* applyNumbers(tx, dedupeNumbers(yield* numbering(tx)));
      }),
    )
    .pipe(Effect.orDie);

  return {
    list: (actor: User, includeHidden: boolean) =>
      Effect.gen(function* () {
        const viewer = yield* loadViewer(read, actor);
        return (yield* lineup).filter(
          (channel) => (includeHidden || !channel.hidden) && seesChannel(viewer, channel.id),
        );
      }),
    get: (actor: User, channelId: string) =>
      Effect.gen(function* () {
        yield* requireChannel(yield* loadViewer(read, actor), channelId);
        return toChannel(yield* findRow(channelId), yield* loadGuideIcons(read));
      }),
    create: (actor: User, input: typeof ChannelInput.Type) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const row: ChannelRow = {
          id: newId(),
          name: input.name,
          number: null,
          logoUrl: input.logoUrl ?? null,
          guideChannelId: input.guideChannelId ?? null,
          favourite: input.favourite,
          hidden: input.hidden,
          removedAt: null,
          mergedInto: null,
        };
        yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.insert(channels).values(row);
              if (input.number !== undefined) {
                yield* placeIn(tx, [ChannelId.make(row.id)], input.number);
              }
            }),
          )
          .pipe(Effect.orDie);
        return toChannel(yield* Effect.orDie(findRow(row.id)));
      }),
    update: (actor: User, channelId: string, patch: typeof ChannelUpdate.Type) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const row = yield* findRow(channelId);
        const number = "number" in patch ? (patch.number ?? null) : row.number;
        const next: ChannelRow = {
          ...row,
          name: patch.name ?? row.name,
          number: number === row.number || number === null ? number : row.number,
          logoUrl: "logoUrl" in patch ? (patch.logoUrl ?? null) : row.logoUrl,
          guideChannelId:
            "guideChannelId" in patch ? (patch.guideChannelId ?? null) : row.guideChannelId,
          favourite: patch.favourite ?? row.favourite,
          hidden: patch.hidden ?? row.hidden,
        };
        // A number belongs to one channel: taking one another channel has moves that one to the
        // next free number above, so the lineup never has two channel 5s.
        yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.update(channels).set(next).where(eq(channels.id, channelId));
              if (number !== null && number !== row.number) {
                yield* placeIn(tx, [ChannelId.make(channelId)], number);
              }
            }),
          )
          .pipe(Effect.orDie);
        return toChannel(yield* findRow(channelId), yield* loadGuideIcons(read));
      }),
    /** Sets one channel's number; the channel holding it moves to the next free one above. */
    setNumber: (actor: User, channelId: string, number: number) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(channelId);
        yield* write
          .transaction((tx) => placeIn(tx, [ChannelId.make(channelId)], number))
          .pipe(Effect.orDie);
        return yield* lineup;
      }),
    /** Moves channels to consecutive numbers from `start`; holders move to the next free ones. */
    placeNumbers: (actor: User, ids: ReadonlyArray<ChannelId>, start: number) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* checkIds(ids, "ids");
        yield* write.transaction((tx) => placeIn(tx, ids, start)).pipe(Effect.orDie);
        return yield* lineup;
      }),
    /** What removing `ids` would cancel: one-off recordings still scheduled on them. */
    removePreview: (actor: User, ids: ReadonlyArray<ChannelId>) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const unique = [...new Set(ids)];
        yield* checkIds(unique, "ids");
        return { scheduledRecordings: (yield* scheduledOneOffs(unique)).length };
      }),
    remove: (actor: User, channelId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(channelId);
        yield* removeChannels([channelId]);
      }),
    removeMany: (actor: User, ids: ReadonlyArray<ChannelId>) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const unique = [...new Set(ids)];
        yield* checkIds(unique, "ids");
        yield* removeChannels(unique);
      }),
    mergePreview: (actor: User, keepId: ChannelId, otherIds: ReadonlyArray<ChannelId>) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const { keep, others } = yield* mergeParties(keepId, otherIds);
        const ids = new Set<string>(otherIds);
        const [counts] = yield* read
          .select({ count: sql<number | bigint>`count(*)` })
          .from(recordings)
          .where(and(inArray(recordings.channelId, [...ids]), isNull(recordings.hiddenAt)))
          .pipe(Effect.orDie);
        const [streams] = yield* read
          .select({ count: sql<number | bigint>`count(DISTINCT ${channelStreams.sourceStreamId})` })
          .from(channelStreams)
          .where(inArray(channelStreams.channelId, [...ids]))
          .pipe(Effect.orDie);
        const named = yield* matchersNaming(ids);
        const icons = yield* loadGuideIcons(read);
        return {
          keep: toChannel(keep, icons),
          others: others.map((row) => toChannel(row, icons)),
          streams: Number(streams?.count ?? 0),
          recordings: Number(counts?.count ?? 0),
          seriesRecordings: named.rules.length,
          collections: named.collections.length,
        };
      }),
    /**
     * Merges channels into `keepId`: their streams join keep's fallback order after its own;
     * recordings, captures, episode history and every channel id in rules, collections and
     * profile access move to keep; keep becomes a favourite if any was and takes a guide
     * channel, logo and number from them when it has none. The others are then removed with
     * `mergedInto` set.
     */
    merge: (actor: User, keepId: ChannelId, otherIds: ReadonlyArray<ChannelId>) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const { keep, others } = yield* mergeParties(keepId, otherIds);
        const ids = new Set<string>(otherIds);
        const now = yield* Clock.currentTimeMillis;
        yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              const links = yield* tx
                .select()
                .from(channelStreams)
                .where(inArray(channelStreams.channelId, [keepId, ...otherIds]))
                .orderBy(asc(channelStreams.priority));
              const order = [keepId as string, ...otherIds];
              const streamIds = [
                ...new Set(
                  order.flatMap((id) =>
                    links
                      .filter((link) => link.channelId === id)
                      .map((link) => link.sourceStreamId),
                  ),
                ),
              ];
              yield* tx
                .delete(channelStreams)
                .where(inArray(channelStreams.channelId, [keepId, ...otherIds]));
              if (streamIds.length > 0) {
                yield* tx.insert(channelStreams).values(
                  streamIds.map((sourceStreamId, priority) => ({
                    id: newId(),
                    channelId: keepId,
                    sourceStreamId,
                    priority,
                  })),
                );
              }
              const moved = [...ids];
              yield* tx
                .update(recordings)
                .set({ channelId: keepId })
                .where(inArray(recordings.channelId, moved));
              yield* tx
                .update(captures)
                .set({ channelId: keepId })
                .where(inArray(captures.channelId, moved));
              yield* tx
                .update(episodeHistory)
                .set({ channelId: keepId })
                .where(inArray(episodeHistory.channelId, moved));
              for (const row of yield* tx.select().from(rules)) {
                const matcher = remapMatcher(row.matcher, ids, keepId);
                if (matcher !== row.matcher) {
                  yield* tx.update(rules).set({ matcher }).where(eq(rules.id, row.id));
                }
              }
              for (const row of yield* tx.select().from(collections)) {
                const matcher = remapMatcher(row.matcher, ids, keepId);
                if (matcher !== row.matcher) {
                  yield* tx.update(collections).set({ matcher }).where(eq(collections.id, row.id));
                }
              }
              for (const row of yield* tx
                .select({ id: users.id, access: users.access })
                .from(users)) {
                const channelIds = row.access?.channelIds;
                if (row.access === null || channelIds === undefined) continue;
                if (!channelIds.some((id) => ids.has(id))) continue;
                yield* tx
                  .update(users)
                  .set({
                    access: {
                      ...row.access,
                      channelIds: [...new Set(channelIds.map((id) => (ids.has(id) ? keepId : id)))],
                    },
                  })
                  .where(eq(users.id, row.id));
              }
              yield* tx
                .update(channels)
                .set({
                  favourite: keep.favourite || others.some((row) => row.favourite),
                  guideChannelId:
                    keep.guideChannelId ??
                    others.find((row) => row.guideChannelId !== null)?.guideChannelId ??
                    null,
                  logoUrl:
                    keep.logoUrl ?? others.find((row) => row.logoUrl !== null)?.logoUrl ?? null,
                })
                .where(eq(channels.id, keepId));
              yield* softRemove(tx, moved, now, keepId);
              if (keep.number === null) {
                const number = others.find((row) => row.number !== null)?.number;
                if (number !== undefined && number !== null) {
                  yield* placeIn(tx, [keepId], number);
                }
              }
            }),
          )
          .pipe(Effect.orDie);
        return toChannel(yield* findRow(keepId), yield* loadGuideIcons(read));
      }),
    /**
     * Takes one stream out of a channel into a new channel of its own: named after the stream,
     * numbered like an import, with the stream's guide channel when a guide lists it.
     */
    split: (actor: User, channelId: string, sourceStreamId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(channelId);
        const links = yield* streamsOf(channelId);
        if (!links.some((link) => link.sourceStreamId === sourceStreamId)) {
          return yield* new InvalidInput({
            problems: [{ path: "sourceStreamId", code: "notOnChannel" }],
          });
        }
        if (links.length === 1) {
          return yield* new InvalidInput({
            problems: [{ path: "sourceStreamId", code: "onlyStream" }],
          });
        }
        const [stream] = yield* read
          .select()
          .from(sourceStreams)
          .where(eq(sourceStreams.id, sourceStreamId))
          .pipe(Effect.orDie);
        if (stream === undefined) {
          return yield* new InvalidInput({
            problems: [{ path: "sourceStreamId", code: "unknownSourceStream" }],
          });
        }
        const id = newId();
        const now = yield* Clock.currentTimeMillis;
        yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              const [guide] =
                stream.tvgId === null
                  ? []
                  : yield* tx
                      .select({ id: guideChannels.xmltvId })
                      .from(guideChannels)
                      .where(eq(guideChannels.xmltvId, stream.tvgId))
                      .limit(1);
              yield* tx
                .delete(channelStreams)
                .where(
                  and(
                    eq(channelStreams.channelId, channelId),
                    eq(channelStreams.sourceStreamId, sourceStreamId),
                  ),
                );
              yield* tx.insert(channels).values({
                id,
                name: stream.name,
                number: importNumber(
                  yield* takenNumbers(tx),
                  parseChannelNumber(stream.channelNumber ?? undefined),
                ),
                logoUrl: stream.logoUrl,
                guideChannelId: guide?.id ?? null,
                favourite: false,
                hidden: false,
              });
              yield* tx
                .insert(channelStreams)
                .values({ id: newId(), channelId: id, sourceStreamId, priority: 0 });
              // Split off on purpose: never suggested back to the channel it came from.
              yield* tx
                .insert(channelsApart)
                .values(apartRows([channelId, id], now))
                .onConflictDoNothing();
            }),
          )
          .pipe(Effect.orDie);
        return toChannel(yield* findRow(id), yield* loadGuideIcons(read));
      }),
    /** "Not the same": `ids` are never suggested for merging with one another again. */
    keepApart: (actor: User, ids: ReadonlyArray<ChannelId>) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const unique = [...new Set(ids)];
        if (unique.length < 2) {
          return yield* new InvalidInput({ problems: [{ path: "ids", code: "tooFew" }] });
        }
        yield* checkIds(unique, "ids");
        const now = yield* Clock.currentTimeMillis;
        yield* write
          .insert(channelsApart)
          .values(apartRows(unique, now))
          .onConflictDoNothing()
          .pipe(Effect.orDie);
      }),
    /**
     * What needs an admin's eye: channels that look like copies of one another, new and gone
     * streams per source, and channels with no stream left. Two queries for the lineup and one
     * for the sources' counts.
     */
    review: (actor: User) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const rows = yield* read
          .select({
            channel: channels,
            streamId: sourceStreams.id,
            streamName: sourceStreams.name,
            tvgId: sourceStreams.tvgId,
            sourceId: sourceStreams.sourceId,
            sourceName: sources.name,
            lastSeenAt: sourceStreams.lastSeenAt,
            lastRefreshAt: sources.lastRefreshAt,
          })
          .from(channels)
          .leftJoin(channelStreams, eq(channelStreams.channelId, channels.id))
          .leftJoin(sourceStreams, eq(sourceStreams.id, channelStreams.sourceStreamId))
          .leftJoin(sources, eq(sources.id, sourceStreams.sourceId))
          .where(liveChannel)
          .orderBy(asc(channelStreams.priority))
          .pipe(Effect.orDie);
        const icons = yield* loadGuideIcons(read);
        const byId = new Map<
          string,
          {
            id: string;
            name: string;
            number: number | null;
            row: ChannelRow;
            guideIds: Set<string>;
            streams: Array<{ name: string; sourceName: string }>;
            /** The source of the first stream still listed. */
            playsFrom: string | undefined;
          }
        >();
        const gone: Array<{
          sourceStreamId: string;
          sourceId: string;
          name: string;
          channelId: string;
        }> = [];
        for (const row of rows) {
          const channel = byId.get(row.channel.id) ?? {
            id: row.channel.id,
            name: row.channel.name,
            number: row.channel.number,
            row: row.channel,
            guideIds: new Set<string>(),
            streams: [],
            playsFrom: undefined,
          };
          byId.set(row.channel.id, channel);
          if (row.channel.guideChannelId !== null) channel.guideIds.add(row.channel.guideChannelId);
          if (row.streamId === null || row.sourceId === null) continue;
          if (row.tvgId !== null) channel.guideIds.add(row.tvgId);
          const sourceName = row.sourceName ?? "";
          channel.streams.push({ name: row.streamName ?? "", sourceName });
          const isGone =
            row.lastRefreshAt !== null &&
            row.lastSeenAt !== null &&
            row.lastSeenAt < row.lastRefreshAt;
          if (!isGone) channel.playsFrom ??= sourceName;
          else {
            gone.push({
              sourceStreamId: row.streamId,
              sourceId: row.sourceId,
              name: row.streamName ?? "",
              channelId: row.channel.id,
            });
          }
        }
        // A hidden channel is out of sight: what it lost waits until it is shown again.
        const goneStreams = gone.flatMap((entry) => {
          const channel = byId.get(entry.channelId);
          if (channel === undefined || channel.row.hidden) return [];
          return [
            {
              sourceStreamId: SourceStreamId.make(entry.sourceStreamId),
              sourceId: SourceId.make(entry.sourceId),
              name: entry.name,
              channel: { id: ChannelId.make(entry.channelId), name: channel.name },
              ...opt("playsFrom", channel.playsFrom ?? null),
            },
          ];
        });
        const apart = new Set(
          (yield* read.select().from(channelsApart).pipe(Effect.orDie)).map((pair) =>
            channelPairKey(pair.channelA, pair.channelB),
          ),
        );
        const ordered = [...byId.values()].toSorted((a, b) =>
          guideChannelOrder(
            { name: a.name, ...opt("number", a.number) },
            { name: b.name, ...opt("number", b.number) },
          ),
        );
        const suggestions = mergeSuggestions(
          ordered.map((channel) => ({ ...channel, guideIds: [...channel.guideIds] })),
          apart,
        );
        const counts = yield* read
          .select({
            sourceId: sources.id,
            name: sources.name,
            newStreams: sql<
              number | bigint
            >`count(DISTINCT CASE WHEN ${channelStreams.id} IS NULL AND ${sourceStreams.ignoredAt} IS NULL AND ${sourceStreams.firstSeenAt} > coalesce(${sources.reviewedAt}, -1) THEN ${sourceStreams.id} END)`,
            goneStreams: sql<
              number | bigint
            >`count(DISTINCT CASE WHEN ${channelStreams.id} IS NOT NULL AND ${sourceStreams.lastSeenAt} < ${sources.lastRefreshAt} THEN ${sourceStreams.id} END)`,
          })
          .from(sources)
          .leftJoin(sourceStreams, eq(sourceStreams.sourceId, sources.id))
          .leftJoin(channelStreams, eq(channelStreams.sourceStreamId, sourceStreams.id))
          .groupBy(sources.id)
          .orderBy(asc(sources.name))
          .pipe(Effect.orDie);
        return {
          mergeSuggestions: suggestions.map((suggestion) => ({
            channels: suggestion.channelIds.flatMap((id) => {
              const channel = byId.get(id);
              if (channel === undefined) return [];
              const shown = toChannel(channel.row, icons);
              return [
                {
                  id: shown.id,
                  name: shown.name,
                  ...opt("number", shown.number ?? null),
                  ...opt("logoUrl", shown.logoUrl ?? null),
                  streams: channel.streams,
                },
              ];
            }),
            reason: suggestion.reason,
          })),
          sources: counts.map((row) => ({
            sourceId: SourceId.make(row.sourceId),
            name: row.name,
            newStreams: Number(row.newStreams),
            goneStreams: Number(row.goneStreams),
          })),
          goneStreams,
          withoutStreams: ordered
            .filter((channel) => channel.playsFrom === undefined && !channel.row.hidden)
            .map((channel) => ({ id: ChannelId.make(channel.id), name: channel.name })),
        } satisfies typeof ChannelReview.Type;
      }),
    /** Guide channels of every source whose name or id contains `search` (admin). */
    guideChannels: (actor: User, search: string | undefined) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const term = search?.trim().toLowerCase() ?? "";
        const rows = yield* read
          .select()
          .from(guideChannels)
          .where(
            term === ""
              ? undefined
              : sql`(lower(${guideChannels.displayName}) LIKE ${likeTerm(term)} ESCAPE '\\' OR lower(${guideChannels.xmltvId}) LIKE ${likeTerm(term)} ESCAPE '\\')`,
          )
          .orderBy(asc(guideChannels.displayName), asc(guideChannels.xmltvId))
          .limit(SEARCH_LIMIT)
          .pipe(Effect.orDie);
        return yield* guideViews(rows.map((guide) => ({ guide })));
      }),
    /** Guide channels that likely fit a channel, best first (admin). */
    guideSuggestions: (actor: User, channelId: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        const row = yield* findRow(channelId);
        const tvgIds = yield* read
          .select({ tvgId: sourceStreams.tvgId })
          .from(channelStreams)
          .innerJoin(sourceStreams, eq(sourceStreams.id, channelStreams.sourceStreamId))
          .where(eq(channelStreams.channelId, channelId))
          .pipe(Effect.orDie);
        const guides = yield* read.select().from(guideChannels).pipe(Effect.orDie);
        return yield* guideViews(
          guideSuggestions(
            {
              name: row.name,
              tvgIds: tvgIds.flatMap((entry) => (entry.tvgId === null ? [] : [entry.tvgId])),
            },
            guides,
          ),
        );
      }),
    streams: (actor: User, channelId: string) =>
      Effect.gen(function* () {
        yield* requireChannel(yield* loadViewer(read, actor), channelId);
        yield* findRow(channelId);
        return yield* streamsOf(channelId);
      }),
    setStreams: (
      actor: User,
      channelId: string,
      input: ReadonlyArray<typeof ChannelStreamInput.Type>,
    ) =>
      Effect.gen(function* () {
        yield* requireAdmin(actor);
        yield* findRow(channelId);
        const known = yield* sourcesService.existingStreamIds(
          input.map((entry) => entry.sourceStreamId),
        );
        const seen = new Set<string>();
        const problems = input.flatMap((entry, index) => {
          if (!known.has(entry.sourceStreamId)) {
            return [{ path: `${index}.sourceStreamId`, code: "unknownSourceStream" }];
          }
          if (seen.has(entry.sourceStreamId))
            return [{ path: `${index}.sourceStreamId`, code: "duplicate" }];
          seen.add(entry.sourceStreamId);
          return [];
        });
        if (problems.length > 0) return yield* new InvalidInput({ problems });
        yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.delete(channelStreams).where(eq(channelStreams.channelId, channelId));
              if (input.length > 0) {
                yield* tx.insert(channelStreams).values(
                  input.map((entry) => ({
                    id: newId(),
                    channelId,
                    sourceStreamId: entry.sourceStreamId,
                    priority: entry.priority,
                  })),
                );
              }
            }),
          )
          .pipe(Effect.orDie);
        return yield* streamsOf(channelId);
      }),
  };
});

/** A guide channel row as the mapping lists show it. */
const guideView = (
  row: typeof guideChannels.$inferSelect,
  mapped: ReadonlyMap<string, number>,
): GuideChannelView => ({
  sourceId: SourceId.make(row.sourceId),
  xmltvId: row.xmltvId,
  displayName: row.displayName,
  ...opt("iconUrl", row.iconUrl),
  channels: mapped.get(row.xmltvId) ?? 0,
});

/** The curated channel list. */
export class Channels extends Context.Service<Channels, Effect.Success<typeof makeChannels>>()(
  "@slipstream/server/Channels",
) {
  static readonly layer = Layer.effect(Channels, makeChannels);
}
