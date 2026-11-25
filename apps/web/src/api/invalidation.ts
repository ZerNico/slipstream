import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { keys } from "./queries.ts";

/**
 * Which cached reads a change reaches, one row per kind of change. A write made here and the
 * live event for the same change made elsewhere refetch the very same branches, so a screen
 * never depends on who made the change.
 */
const affected = {
  /** A recording was scheduled, changed state, was protected, stopped or kept. */
  recording: [keys.recordings, keys.programmes, keys.system, keys.guideRepeatsAll],
  /**
   * A recording is gone: the library (collections), home (continue watching, scheduled,
   * conflicts), the record options, storage, and the guide's marks all count it; a deleted
   * episode may now be recorded again or kept out as history.
   */
  recordingRemoved: [
    keys.recordings,
    keys.collections,
    keys.continueWatching,
    keys.programmes,
    keys.system,
    keys.guideRepeatsAll,
    keys.rules,
  ],
  /** A repeat replaced a damaged recording: everything that counts episodes. */
  recordingReplaced: [
    keys.recordings,
    keys.rules,
    keys.collections,
    keys.guideRepeatsAll,
    keys.programmes,
  ],
  /**
   * A collection was created, changed, widened or deleted. Goes to and Automatic in the record
   * options follow the collections; a series recording may record into one.
   */
  collections: [keys.collections, keys.programmes, keys.recordings, keys.rules],
  /**
   * A series recording or its linked collection changed: its offer, preview and history, the
   * recordings it schedules, the collection that follows it and which airings it leaves out.
   */
  rules: [keys.rules, keys.recordings, keys.collections, keys.guideRepeatsAll, keys.programmes],
  /** New guide data: new programmes and channels, and new matches for series recordings. */
  guide: [keys.guide, keys.channels, keys.rules, keys.recordings, keys.programmes],
  /** A source changed: its streams, and what the lineup's review counts from them. */
  sources: [keys.sources, keys.lineupReview],
  /** A source's health shows in the system status. */
  sourceHealth: [keys.system],
  channels: [keys.channels, keys.guide],
  devices: [keys.devices],
  captures: [keys.captures],
  /** A resume point: continue watching and the library's watched state. */
  progress: [keys.continueWatching, keys.recordingList],
} satisfies Record<string, readonly QueryKey[]>;

/** A kind of change the cache follows. */
export type Change = keyof typeof affected;

/** Refetches every read the changes reach. */
export const invalidateFor = (
  client: QueryClient,
  ...changes: readonly Change[]
): Promise<unknown> =>
  Promise.all(
    [...new Set(changes.flatMap((change): readonly QueryKey[] => affected[change]))].map(
      (queryKey) => client.invalidateQueries({ queryKey }),
    ),
  );
