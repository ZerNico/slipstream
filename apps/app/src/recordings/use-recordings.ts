import type { RecordingEntry } from "@slipstream/api";
import { pathLabels } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useApiQueries } from "../data/hooks.ts";
import { channelNames } from "../data/home.ts";
import { type LibraryFilter, libraryView } from "../data/library.ts";
import { problemItems } from "./problem-items.ts";

/**
 * Every recording this profile sees (library, scheduled, failed), with the channel names and
 * the collections a page needs to place one: what recording, place and problems pages read on
 * phone and TV.
 */
export const useRecordings = () => {
  const queries = useApiQueries();
  const recordings = useQuery(queries.recordings());
  const channels = useQuery(queries.channels());
  const collections = useQuery(queries.collections());
  const all: readonly RecordingEntry[] = useMemo(() => recordings.data ?? [], [recordings.data]);
  const names = useMemo(() => channelNames(channels.data ?? []), [channels.data]);
  return {
    all,
    names,
    collections: collections.data ?? [],
    loading: recordings.isPending || channels.isPending,
    error: recordings.error ?? channels.error,
    retry: () => {
      void recordings.refetch();
      void channels.refetch();
    },
  };
};

/**
 * The library page on phone and TV: {@link useRecordings}, the places of what is shown under
 * `filter` (the domain's grouping), and the counts its links show. "Needs attention" counts the
 * Problems list's own items, so the link and the page agree.
 */
export const useLibraryView = (filter: LibraryFilter, now: number) => {
  const queries = useApiQueries();
  const index = useRecordings();
  const rules = useQuery(queries.rules());
  const view = useMemo(
    () => libraryView(index.all, index.collections, pathLabels(), filter),
    [index.all, index.collections, filter],
  );
  const attention = useMemo(() => problemItems(index.all, now).length, [index.all, now]);
  return { ...index, ...view, attention, series: rules.data?.length ?? 0 };
};
