/**
 * The household's stream limits as the domain's `detectConflicts` takes them: which sources carry
 * each channel and how many streams each source allows. Planning (which airings the sources cannot
 * serve together) and the schedule conflicts of the recordings library read them the same way.
 */
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { type ChannelSources, ChannelId, SourceId, type SourceLimit } from "@slipstream/domain";
import type { Database, Transaction } from "../db/client.ts";
import { channelStreams, sources, sourceStreams } from "../db/schema.ts";

/** Every channel's sources and every source's limit. */
export interface StreamLimits {
  /** The sources of each channel, once each, in the order of its streams' priority. */
  readonly channels: ReadonlyArray<ChannelSources>;
  readonly sources: ReadonlyArray<SourceLimit>;
}

/** Reads the stream limits (two small queries). */
export const loadStreamLimits = (db: Database | Transaction): Effect.Effect<StreamLimits> =>
  Effect.gen(function* () {
    const links = yield* db
      .select({ channelId: channelStreams.channelId, sourceId: sourceStreams.sourceId })
      .from(channelStreams)
      .innerJoin(sourceStreams, eq(sourceStreams.id, channelStreams.sourceStreamId))
      .orderBy(asc(channelStreams.priority));
    const limits = yield* db
      .select({ id: sources.id, maxStreams: sources.maxStreams })
      .from(sources);
    const sourcesOf = new Map<string, Set<SourceId>>();
    for (const link of links) {
      const known = sourcesOf.get(link.channelId) ?? new Set();
      known.add(SourceId.make(link.sourceId));
      sourcesOf.set(link.channelId, known);
    }
    return {
      channels: [...sourcesOf].map(([channelId, sourceIds]) => ({
        channelId: ChannelId.make(channelId),
        sourceIds: [...sourceIds],
      })),
      sources: limits.map((row) => ({
        id: SourceId.make(row.id),
        maxStreams: row.maxStreams ?? undefined,
      })),
    };
  }).pipe(Effect.orDie);
