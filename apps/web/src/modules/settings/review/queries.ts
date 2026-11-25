import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SourceStreamEntry } from "@slipstream/api";
import type { ChannelId, FoundStream, SourceId, SourceStreamId } from "@slipstream/domain";
import type { Api } from "~/api/client.ts";
import { useApi } from "~/api/hooks.ts";
import { invalidateFor } from "~/api/invalidation.ts";
import { keys } from "~/api/queries.ts";

/*
 * Needs review's reads and writes. Keys sit under the lineup review (itself under `channels`),
 * so any channel or source change refetches them.
 */

/** How many matches the stream search takes from each source. */
const SEARCH_LIMIT = 50;

/** A source as the stream search names it. */
interface NamedSource {
  readonly id: SourceId;
  readonly name: string;
}

/** Needs review's read options for one {@link Api}. */
export const reviewQueries = (api: Api) => ({
  /** What a merge would move to the kept channel ("2 series recordings and 14 recordings"). */
  mergePreview: (keepId: ChannelId, otherIds: readonly ChannelId[]) =>
    queryOptions({
      queryKey: [...keys.lineupReview, "preview", keepId, ...otherIds] as const,
      queryFn: () =>
        api.call((c) => c.channels.mergePreview({ payload: { keepId, otherIds: [...otherIds] } })),
      staleTime: 30_000,
    }),
  /** Streams of every source whose name contains `search`, at most 50 per source. */
  findStreams: (sources: readonly NamedSource[], search: string) =>
    queryOptions({
      queryKey: [...keys.lineupReview, "find", search, sources.map((s) => s.id).join(",")] as const,
      queryFn: async (): Promise<FoundStream[]> => {
        const pages = await Promise.all(
          sources.map((source) =>
            api.call((c) =>
              c.sources.catalogue({
                params: { sourceId: source.id },
                query: { search, limit: SEARCH_LIMIT },
              }),
            ),
          ),
        );
        return sources.flatMap((source, index) =>
          (pages[index]?.streams ?? []).map((entry: SourceStreamEntry): FoundStream => ({
            id: entry.id,
            name: entry.name,
            sourceId: source.id,
            sourceName: source.name,
            group: entry.group,
            channel: entry.channel,
          })),
        );
      },
      enabled: search.trim() !== "",
      staleTime: 30_000,
      placeholderData: (previous) => previous,
    }),
});

/** Needs review's read options for this app's API. */
export const useReviewQueries = () => reviewQueries(useApi());

/** One merge: `otherIds` join `keepId`, whose streams stay first. */
export interface MergeInput {
  readonly keepId: ChannelId;
  readonly otherIds: readonly ChannelId[];
}

/** Merges, one after another (one for a row, several for Merge all); settles once at the end. */
export const useMerge = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (merges: readonly MergeInput[]) => {
      for (const merge of merges) {
        await api.call((c) =>
          c.channels.merge({ payload: { keepId: merge.keepId, otherIds: [...merge.otherIds] } }),
        );
      }
    },
    onSettled: () => invalidateFor(client, "channels", "recording", "rules", "collections"),
  });
};

/** "Not the same": the channels are never suggested together again. */
export const useKeepApart = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: readonly ChannelId[]) =>
      api.call((c) => c.channels.keepApart({ payload: { ids: [...ids] } })),
    onSettled: () => client.invalidateQueries({ queryKey: keys.lineupReview }),
  });
};

/** Ignore new streams: the sources count as reviewed, so nothing of theirs is new any more. */
export const useMarkReviewed = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: readonly SourceId[]) =>
      Promise.all(
        ids.map((id) => api.call((c) => c.sources.markReviewed({ params: { sourceId: id } }))),
      ),
    onSettled: () => invalidateFor(client, "sources"),
  });
};

/**
 * Adds a stream to a channel as its last fallback. A stream on another channel moves: it leaves
 * that channel first.
 */
export const useAddStream = () => {
  const api = useApi();
  const client = useQueryClient();
  const setStreams = (channelId: ChannelId, ids: readonly SourceStreamId[]) =>
    api.call((c) =>
      c.channels.setStreams({
        params: { channelId },
        payload: ids.map((sourceStreamId, priority) => ({ sourceStreamId, priority })),
      }),
    );
  const current = (channelId: ChannelId) =>
    api
      .call((c) => c.channels.streams({ params: { channelId } }))
      .then((links) =>
        links.toSorted((a, b) => a.priority - b.priority).map((link) => link.sourceStreamId),
      );
  return useMutation({
    mutationFn: async (input: {
      readonly channelId: ChannelId;
      readonly streamId: SourceStreamId;
      readonly from?: ChannelId | undefined;
    }) => {
      if (input.from !== undefined && input.from !== input.channelId) {
        const theirs = await current(input.from);
        await setStreams(
          input.from,
          theirs.filter((id) => id !== input.streamId),
        );
      }
      const ours = await current(input.channelId);
      if (ours.includes(input.streamId)) return;
      await setStreams(input.channelId, [...ours, input.streamId]);
    },
    onSettled: () => invalidateFor(client, "channels", "sources"),
  });
};
