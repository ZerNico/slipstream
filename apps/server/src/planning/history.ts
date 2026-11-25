/**
 * The episode history in `episode_history` (recording model §3.6): episodes people had and
 * deleted, per owner, so a series recording set to "Only episodes you don't have yet" does not
 * record them again.
 */
import { DateTime, Effect } from "effect";
import { ChannelId, type EpisodeHistoryEntry, RuleId, UserId } from "@slipstream/domain";
import type { Database, Transaction } from "../db/client.ts";
import { toInstant } from "../db/codec.ts";
import { episodeHistory } from "../db/schema.ts";
import { newId } from "../ids.ts";

/** A history row as the domain sees it. */
export const toHistoryEntry = (row: typeof episodeHistory.$inferSelect): EpisodeHistoryEntry => ({
  userId: UserId.make(row.userId),
  ...(row.ruleId === null ? {} : { ruleId: RuleId.make(row.ruleId) }),
  showKey: row.showKey,
  class: row.class,
  ...(row.season === null ? {} : { season: row.season }),
  ...(row.episode === null ? {} : { episode: row.episode }),
  ...(row.subtitleKey === null ? {} : { subtitleKey: row.subtitleKey }),
  ...(row.filmYear === null ? {} : { filmYear: row.filmYear }),
  airedAt: toInstant(row.airedAt),
  channelId: ChannelId.make(row.channelId),
  title: row.title,
});

/** Writes one history row per entry, created at `now` (epoch ms). */
export const addHistory = (
  db: Database | Transaction,
  entries: ReadonlyArray<EpisodeHistoryEntry>,
  now: number,
) =>
  entries.length === 0
    ? Effect.void
    : db
        .insert(episodeHistory)
        .values(
          entries.map((entry) => ({
            id: newId(),
            userId: entry.userId,
            ruleId: entry.ruleId ?? null,
            showKey: entry.showKey,
            season: entry.season ?? null,
            episode: entry.episode ?? null,
            subtitleKey: entry.subtitleKey ?? null,
            filmYear: entry.filmYear ?? null,
            class: entry.class,
            airedAt: DateTime.toEpochMillis(entry.airedAt),
            channelId: entry.channelId,
            title: entry.title,
            createdAt: now,
          })),
        )
        .pipe(Effect.asVoid);
