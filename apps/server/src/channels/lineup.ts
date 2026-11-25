/**
 * The lineup's shared writes and reads, used inside the sources refresh and the channel and
 * source services alike: which channels are live, the numbers in use, and turning streams into
 * channels (copies of one channel become one channel; a stream with the guide id of an existing
 * channel joins it as its last fallback).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { type Channel, ChannelId, groupVariants, importNumber } from "@slipstream/domain";
import type { Database, Transaction } from "../db/client.ts";
import { chunks, opt } from "../db/codec.ts";
import {
  channels,
  channelStreams,
  guideChannels,
  type programmes,
  sourceStreams,
} from "../db/schema.ts";
import { newId } from "../ids.ts";
import { parseChannelNumber } from "../sources/mapping.ts";

type ChannelRow = typeof channels.$inferSelect;
type StreamRow = Pick<
  typeof sourceStreams.$inferSelect,
  "id" | "name" | "tvgId" | "logoUrl" | "channelNumber"
>;

/**
 * A channel row as the API shows it. Without a logo of its own (from the playlist or set by
 * hand) it takes its guide channel's icon, when the guide has one.
 */
export const toChannel = (row: ChannelRow, guideIcons?: ReadonlyMap<string, string>): Channel => ({
  id: ChannelId.make(row.id),
  name: row.name,
  ...opt("number", row.number),
  ...opt(
    "logoUrl",
    row.logoUrl ??
      (row.guideChannelId === null ? null : (guideIcons?.get(row.guideChannelId) ?? null)),
  ),
  ...opt("guideChannelId", row.guideChannelId),
  favourite: row.favourite,
  hidden: row.hidden,
});

/** Each guide channel's icon by its XMLTV id, the first source's when several list it. */
export const loadGuideIcons = (db: Database) =>
  db
    .select({ xmltvId: guideChannels.xmltvId, iconUrl: guideChannels.iconUrl })
    .from(guideChannels)
    .pipe(
      Effect.map((rows) => {
        const icons = new Map<string, string>();
        for (const row of rows) {
          if (row.iconUrl !== null && !icons.has(row.xmltvId)) icons.set(row.xmltvId, row.iconUrl);
        }
        return icons;
      }),
      Effect.orDie,
    );

/** SQL condition: a channel nobody removed. */
export const liveChannel = isNull(channels.removedAt);

/** SQL join condition: a guide's programmes on the live channels that carry its guide channel. */
export const onLiveChannel = (guideChannelId: typeof programmes.guideChannelId) =>
  and(eq(channels.guideChannelId, guideChannelId), liveChannel);

/** The numbers live channels hold. */
export const takenNumbers = (db: Database | Transaction) =>
  db
    .select({ number: channels.number })
    .from(channels)
    .where(and(liveChannel, sql`${channels.number} IS NOT NULL`))
    .pipe(
      Effect.map(
        (rows) => new Set(rows.flatMap((row) => (row.number === null ? [] : [row.number]))),
      ),
      Effect.orDie,
    );

/**
 * Every live channel with the guide ids it is known by (its guide channel and its streams'
 * tvg-ids), in one query.
 */
export const matchableChannels = (db: Database | Transaction) =>
  db
    .select({
      id: channels.id,
      name: channels.name,
      number: channels.number,
      guideChannelId: channels.guideChannelId,
      tvgId: sourceStreams.tvgId,
    })
    .from(channels)
    .leftJoin(channelStreams, eq(channelStreams.channelId, channels.id))
    .leftJoin(sourceStreams, eq(sourceStreams.id, channelStreams.sourceStreamId))
    .where(liveChannel)
    .pipe(
      Effect.map((rows) => {
        const byId = new Map<
          string,
          { id: string; name: string; number: number | null; guideIds: Set<string> }
        >();
        for (const row of rows) {
          const known = byId.get(row.id) ?? {
            id: row.id,
            name: row.name,
            number: row.number,
            guideIds: new Set<string>(),
          };
          if (row.guideChannelId !== null) known.guideIds.add(row.guideChannelId);
          if (row.tvgId !== null) known.guideIds.add(row.tvgId);
          byId.set(row.id, known);
        }
        return [...byId.values()].map((channel) => ({
          ...channel,
          guideIds: [...channel.guideIds],
        }));
      }),
      Effect.orDie,
    );

/** Appends streams to a channel's fallback order, after the ones it has. */
export const appendStreams = (
  tx: Transaction,
  channelId: string,
  streamIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (streamIds.length === 0) return;
    const [last] = yield* (
      tx
        // SQLite hands raw aggregates back as BigInt.
        .select({ priority: sql<number | bigint | null>`max(${channelStreams.priority})` })
        .from(channelStreams)
        .where(eq(channelStreams.channelId, channelId))
    );
    const start =
      last?.priority === null || last?.priority === undefined ? 0 : Number(last.priority) + 1;
    yield* tx.insert(channelStreams).values(
      streamIds.map((sourceStreamId, index) => ({
        id: newId(),
        channelId,
        sourceStreamId,
        priority: start + index,
      })),
    );
  });

/** What turning streams into channels did. */
export interface AddResult {
  readonly created: Array<ChannelRow>;
  readonly joined: Array<{ sourceStreamId: string; channelId: ChannelId; name: string }>;
}

/**
 * Turns streams into channels, inside the caller's transaction. Copies of one channel (same
 * channel key) become one channel with the best quality first and the rest as fallbacks. A
 * group whose stream has the tvg-id of exactly one existing channel joins that channel as its
 * last fallbacks instead. A new channel takes the playlist's number when it is free, else the
 * one after the highest in use; its guide channel is the stream's tvg-id when a guide lists it.
 * Streams already linked to a channel are skipped.
 */
export const addStreamsAsChannels = (tx: Transaction, streams: ReadonlyArray<StreamRow>) =>
  Effect.gen(function* () {
    const result: AddResult = { created: [], joined: [] };
    if (streams.length === 0) return result;
    const linked = new Set<string>();
    for (const ids of chunks(
      streams.map((stream) => stream.id),
      500,
    )) {
      const rows = yield* tx
        .select({ id: channelStreams.sourceStreamId })
        .from(channelStreams)
        .where(inArray(channelStreams.sourceStreamId, [...ids]));
      for (const row of rows) linked.add(row.id);
    }
    const fresh = streams.filter((stream) => !linked.has(stream.id));
    if (fresh.length === 0) return result;

    const existing = yield* matchableChannels(tx);
    const names = new Map(existing.map((channel) => [channel.id, channel.name]));
    const byGuide = new Map<string, Set<string>>();
    const register = (guideId: string, channelId: string) =>
      byGuide.set(guideId, (byGuide.get(guideId) ?? new Set()).add(channelId));
    for (const channel of existing) {
      for (const guideId of channel.guideIds) register(guideId, channel.id);
    }
    const taken = yield* takenNumbers(tx);
    const guideIds = new Set(
      (yield* tx.selectDistinct({ id: guideChannels.xmltvId }).from(guideChannels)).map(
        (row) => row.id,
      ),
    );

    for (const group of groupVariants(fresh)) {
      const target = group
        .flatMap((stream) => {
          const ids = stream.tvgId === null ? undefined : byGuide.get(stream.tvgId);
          return ids !== undefined && ids.size === 1 ? [...ids] : [];
        })
        .at(0);
      if (target !== undefined) {
        yield* appendStreams(
          tx,
          target,
          group.map((stream) => stream.id),
        );
        const name = names.get(target) ?? "";
        for (const stream of group) {
          result.joined.push({
            sourceStreamId: stream.id,
            channelId: ChannelId.make(target),
            name,
          });
        }
        continue;
      }
      const [best] = group;
      if (best === undefined) continue;
      const wanted = group
        .map((stream) => parseChannelNumber(stream.channelNumber ?? undefined))
        .find((number) => number !== undefined);
      const number = importNumber(taken, wanted);
      taken.add(number);
      const guideChannelId =
        group.map((stream) => stream.tvgId).find((id) => id !== null && guideIds.has(id)) ?? null;
      const row: ChannelRow = {
        id: newId(),
        name: best.name,
        number,
        logoUrl: group.map((stream) => stream.logoUrl).find((logo) => logo !== null) ?? null,
        guideChannelId,
        favourite: false,
        hidden: false,
        removedAt: null,
        mergedInto: null,
      };
      yield* tx.insert(channels).values(row);
      yield* appendStreams(
        tx,
        row.id,
        group.map((stream) => stream.id),
      );
      result.created.push(row);
      names.set(row.id, row.name);
      for (const stream of group) if (stream.tvgId !== null) register(stream.tvgId, row.id);
      if (guideChannelId !== null) register(guideChannelId, row.id);
    }
    return result;
  });

/**
 * Attaches streams with the tvg-id of exactly one live channel to that channel as its last
 * fallbacks (a refresh's new streams). Returns how many were attached.
 */
export const attachByGuide = (tx: Transaction, streams: ReadonlyArray<StreamRow>) =>
  Effect.gen(function* () {
    const withGuide = streams.filter((stream) => stream.tvgId !== null && stream.tvgId !== "");
    if (withGuide.length === 0) return 0;
    const existing = yield* matchableChannels(tx);
    const byGuide = new Map<string, Set<string>>();
    for (const channel of existing) {
      for (const guideId of channel.guideIds) {
        byGuide.set(guideId, (byGuide.get(guideId) ?? new Set()).add(channel.id));
      }
    }
    const byChannel = new Map<string, Array<string>>();
    for (const stream of withGuide) {
      const ids = byGuide.get(stream.tvgId ?? "");
      if (ids === undefined || ids.size !== 1) continue;
      const [channelId = ""] = ids;
      byChannel.set(channelId, [...(byChannel.get(channelId) ?? []), stream.id]);
    }
    for (const [channelId, streamIds] of byChannel) yield* appendStreams(tx, channelId, streamIds);
    return [...byChannel.values()].reduce((sum, ids) => sum + ids.length, 0);
  });
