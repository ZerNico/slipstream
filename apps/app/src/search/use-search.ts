import type { RecordingEntry } from "@slipstream/api";
import {
  type Channel,
  epochMs,
  parseRecentSearches,
  type Programme,
  rememberSearch,
  searchChannels,
  searchesGuide,
  searchRecordings,
  splitByAiring,
} from "@slipstream/domain";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useApiQueries, useConflictWindow } from "../data/hooks.ts";
import { persistedStore, useStore } from "../data/store.ts";
import { channelNames } from "../data/home.ts";
import { channelPlayTarget, type PickedProgramme, playerParams } from "../player/playback.ts";
import { useNow } from "../ui/use-now.ts";
import { useSettled } from "../ui/use-settled.ts";

/** How long typing pauses before the results follow it. */
const DEBOUNCE_MS = 250;

/** How many results a row (TV) or group (phone) shows at most. */
const PER_GROUP = 12;

/** This device's recent searches (not the account's), newest first; loaded at start. */
export const recentSearches = persistedStore<readonly string[]>({
  key: "slipstream.searches",
  initial: [],
  // A search made while it loaded stays in front.
  parse: (raw, current) =>
    parseRecentSearches(raw).reduce(
      (list, query) => (list.includes(query) ? list : [...list, query]),
      current,
    ),
  serialise: (list) => JSON.stringify(list),
});

/** This device's recent searches, newest first, and a way to add one. */
export const useRecentSearches = () => {
  const recent = useStore(recentSearches);
  const remember = useCallback((query: string) => {
    const current = recentSearches.get();
    const next = rememberSearch(current, query);
    const same =
      next.length === current.length && next.every((entry, index) => entry === current[index]);
    if (!same) recentSearches.set(next);
  }, []);
  return { recent, remember };
};

/**
 * Search results for `query`: channels and recordings matched here from the lists the app
 * already has, programmes from the server's guide search (from two letters on). All of them
 * follow the query once typing pauses, together, and the previous answer stays while the next
 * one loads, so nothing jumps.
 */
export const useSearch = (query: string) => {
  const queries = useApiQueries();
  const now = useNow(30_000);
  const searched = useSettled(query.trim(), DEBOUNCE_MS);
  const range = useConflictWindow();
  const channels = useQuery(queries.channels());
  const recordings = useQuery(queries.recordings());
  const conflicts = useQuery(queries.conflicts(range.from, range.to));
  const asksGuide = searchesGuide(searched);
  const guide = useQuery({
    ...queries.guideSearch(searched),
    enabled: asksGuide,
    placeholderData: keepPreviousData,
  });
  const programmes = useMemo(
    () => splitByAiring(asksGuide ? (guide.data ?? []) : [], now),
    [asksGuide, guide.data, now],
  );
  const entries: readonly RecordingEntry[] = useMemo(
    () => recordings.data ?? [],
    [recordings.data],
  );
  const foundChannels = useMemo(
    () => searchChannels(channels.data ?? [], searched, PER_GROUP),
    [channels.data, searched],
  );
  const foundRecordings = useMemo(
    () => searchRecordings(entries, searched, PER_GROUP),
    [entries, searched],
  );
  const listsPending = channels.isPending || recordings.isPending;
  const guidePending = asksGuide && guide.isPending;
  return {
    /** The query the results are for (trimmed, once typing paused); empty shows recent ones. */
    searched,
    now,
    channels: foundChannels,
    onNow: programmes.onNow.slice(0, PER_GROUP),
    comingUp: programmes.comingUp.slice(0, PER_GROUP),
    recordings: foundRecordings,
    /** The first answer to a query is still on its way: skeletons hold the rows' places. */
    pending: searched !== "" && (listsPending || guidePending),
    /** Nothing anywhere for this query. */
    none:
      searched !== "" &&
      !listsPending &&
      !guidePending &&
      foundChannels.length === 0 &&
      foundRecordings.length === 0 &&
      programmes.onNow.length === 0 &&
      programmes.comingUp.length === 0,
    error: channels.error ?? recordings.error ?? guide.error,
    retry: () => {
      void channels.refetch();
      void recordings.refetch();
      if (asksGuide) void guide.refetch();
    },
    /** The library, for what a pick plays and for the sheets. */
    entries,
    recordingsPending: recordings.isPending,
    conflicts: conflicts.data ?? [],
    names: channelNames(channels.data ?? []),
  };
};

/** What a channel result plays: live, or the recording running on it from its live edge. */
export const channelTarget = (
  channel: Channel,
  entries: readonly RecordingEntry[],
  now: number,
): Record<string, string> | undefined => {
  const target = channelPlayTarget(channel.id, entries, now);
  return target === undefined ? undefined : playerParams(target);
};

/** A guide search result as the watch pick reads it (times as epoch ms). */
export const pickedProgramme = (programme: Programme): PickedProgramme => ({
  programmeId: programme.id,
  channelId: programme.channelId,
  title: programme.title,
  subtitle: programme.subtitle,
  start: epochMs(programme.start),
  end: epochMs(programme.end),
});
