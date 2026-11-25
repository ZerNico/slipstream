import type { ChannelStreamInput } from "@slipstream/api";
import type {
  ChannelId,
  ChannelUpdate,
  SourceId,
  SourceStreamId,
  SourceView,
} from "@slipstream/domain";
import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useMemo } from "react";
import { Api, type ApiRuntime } from "../../../../api/client.ts";
import type { QueryKey } from "../../../../api/keys.ts";
import { useApiQueries } from "../../../../data/hooks.ts";
import { useApiRuntime } from "../../../../session/session-context.ts";
import { type LineupStream, streamsByChannel } from "./streams.ts";

/*
 * The lineup's reads and writes on the phone (admin). Every key sits under `channels`, so a
 * channel change (`useRefreshAfterChange("channels")`) refetches them all.
 */

/** As many streams as one catalogue page holds: a source's added streams in one read. */
const ALL_ADDED = 5000;

/** The lineup's query keys. */
export const lineupKeys = {
  /** One source's streams that are added to a channel. */
  added: (sourceId: string): QueryKey => ["channels", "added", sourceId],
  streams: (channelId: string): QueryKey => ["channels", "streams", channelId],
  suggestions: (channelId: string): QueryKey => ["channels", "guide-suggestions", channelId],
  guideChannels: (search: string): QueryKey => ["channels", "guide-channels", search],
  nowNext: ["channels", "now-next"] satisfies QueryKey,
  removePreview: (ids: readonly string[]): QueryKey => [
    "channels",
    "remove-preview",
    ids.join(","),
  ],
  /** What needs an admin's eye: merge suggestions, new and gone streams. */
  review: ["channels", "review"] satisfies QueryKey,
  mergePreview: (keepId: string, otherIds: readonly string[]): QueryKey => [
    "channels",
    "merge-preview",
    keepId,
    otherIds.join(","),
  ],
  /** One source's streams matching a search, for adding a stream to a channel. */
  search: (sourceId: string, search: string): QueryKey => [
    "channels",
    "stream-search",
    sourceId,
    search,
  ],
};

/** The most streams one source answers for a search. */
const SEARCH_LIMIT = 50;

/** A channel's stream ids in fallback order. */
const fallbackOrder = (
  links: ReadonlyArray<{ sourceStreamId: SourceStreamId; priority: number }>,
) => links.toSorted((a, b) => a.priority - b.priority).map((link) => link.sourceStreamId);

const apiQuery = <A, E>(
  runtime: ApiRuntime,
  queryKey: QueryKey,
  effect: Effect.Effect<A, E, Api>,
) =>
  queryOptions({
    queryKey,
    queryFn: ({ signal }) => runtime.runPromise(effect, { signal }),
  });

/** Query options for the lineup's reads, bound to one connection's runtime. */
const lineupQueries = (runtime: ApiRuntime) => ({
  added: (sourceId: SourceId) =>
    apiQuery(
      runtime,
      lineupKeys.added(sourceId),
      Effect.flatMap(Api, (api) =>
        api.sources.catalogue({
          params: { sourceId },
          query: { filter: "added", limit: ALL_ADDED },
        }),
      ),
    ),
  /** A channel's links to its streams; lower priority is tried first. */
  streams: (channelId: ChannelId) =>
    apiQuery(
      runtime,
      lineupKeys.streams(channelId),
      Effect.flatMap(Api, (api) => api.channels.streams({ params: { channelId } })),
    ),
  suggestions: (channelId: ChannelId) =>
    apiQuery(
      runtime,
      lineupKeys.suggestions(channelId),
      Effect.flatMap(Api, (api) => api.channels.guideSuggestions({ params: { channelId } })),
    ),
  guideChannels: (search: string) =>
    apiQuery(
      runtime,
      lineupKeys.guideChannels(search),
      Effect.flatMap(Api, (api) =>
        api.channels.guideChannels({ query: search === "" ? {} : { search } }),
      ),
    ),
  /** What is on now and next on every visible channel. */
  nowNext: () =>
    apiQuery(
      runtime,
      lineupKeys.nowNext,
      Effect.flatMap(Api, (api) => api.guide.nowNext()),
    ),
  review: () =>
    apiQuery(
      runtime,
      lineupKeys.review,
      Effect.flatMap(Api, (api) => api.channels.review()),
    ),
  /** What merging `otherIds` into `keepId` moves ("2 series recordings and 14 recordings"). */
  mergePreview: (keepId: ChannelId, otherIds: readonly ChannelId[]) =>
    apiQuery(
      runtime,
      lineupKeys.mergePreview(keepId, otherIds),
      Effect.flatMap(Api, (api) =>
        api.channels.mergePreview({ payload: { keepId, otherIds: [...otherIds] } }),
      ),
    ),
  /** A source's streams whose name has `search`, for adding a stream to a channel. */
  search: (sourceId: SourceId, search: string) =>
    apiQuery(
      runtime,
      lineupKeys.search(sourceId, search),
      Effect.flatMap(Api, (api) =>
        api.sources.catalogue({
          params: { sourceId },
          query: { search, limit: SEARCH_LIMIT },
        }),
      ),
    ),
  /** How many one-off recordings removing `ids` would cancel. */
  removePreview: (ids: readonly ChannelId[]) =>
    apiQuery(
      runtime,
      lineupKeys.removePreview(ids),
      Effect.flatMap(Api, (api) => api.channels.removePreview({ payload: { ids: [...ids] } })),
    ),
});

/** The lineup's query options for the signed-in profile. */
export const useLineupQueries = () => {
  const runtime = useApiRuntime();
  return useMemo(() => lineupQueries(runtime), [runtime]);
};

/** Every channel's streams across the sources, `undefined` until every source answered. */
export const useChannelStreams = ():
  | ReadonlyMap<ChannelId, ReadonlyArray<LineupStream>>
  | undefined => {
  const queries = useApiQueries();
  const lineup = useLineupQueries();
  const sources = useQuery(queries.sources());
  const list: readonly SourceView[] = sources.data ?? [];
  return useQueries({
    queries: list.map((source) => lineup.added(source.id)),
    combine: (results) =>
      sources.data === undefined || results.some((result) => result.data === undefined)
        ? undefined
        : streamsByChannel(
            list.map((source, index) => ({
              sourceId: source.id,
              sourceName: source.name,
              streams: results[index]?.data?.streams ?? [],
            })),
          ),
  });
};

/** The lineup's writes, as effects for `runAction`. */
export const lineupActions = {
  update: (channelId: ChannelId, update: ChannelUpdate) =>
    Effect.flatMap(Api, (api) => api.channels.update({ params: { channelId }, payload: update })),
  setNumber: (channelId: ChannelId, number: number) =>
    Effect.flatMap(Api, (api) =>
      api.channels.setNumber({ params: { channelId }, payload: { number } }),
    ),
  placeNumbers: (ids: readonly ChannelId[], start: number) =>
    Effect.flatMap(Api, (api) => api.channels.placeNumbers({ payload: { ids: [...ids], start } })),
  /** Several channels changed alike (hide, show, favourite), one request each. */
  updateMany: (ids: readonly ChannelId[], update: ChannelUpdate) =>
    Effect.forEach(
      ids,
      (channelId) =>
        Effect.flatMap(Api, (api) =>
          api.channels.update({ params: { channelId }, payload: update }),
        ),
      { concurrency: 4, discard: true },
    ),
  removeMany: (ids: readonly ChannelId[]) =>
    Effect.flatMap(Api, (api) => api.channels.removeMany({ payload: { ids: [...ids] } })),
  setStreams: (channelId: ChannelId, order: readonly SourceStreamId[]) =>
    Effect.flatMap(Api, (api) =>
      api.channels.setStreams({
        params: { channelId },
        payload: order.map((sourceStreamId, priority): ChannelStreamInput => ({
          sourceStreamId,
          priority,
        })),
      }),
    ),
  /** Merges `otherIds` into `keepId`: its streams first, the others' after. */
  merge: (keepId: ChannelId, otherIds: readonly ChannelId[]) =>
    Effect.flatMap(Api, (api) =>
      api.channels.merge({ payload: { keepId, otherIds: [...otherIds] } }),
    ),
  /** "Not the same": never suggested for merging again. */
  keepApart: (ids: readonly ChannelId[]) =>
    Effect.flatMap(Api, (api) => api.channels.keepApart({ payload: { ids: [...ids] } })),
  /** New streams of a source looked at: no longer new. */
  markReviewed: (sourceId: SourceId) =>
    Effect.flatMap(Api, (api) => api.sources.markReviewed({ params: { sourceId } })),
  /**
   * Adds a stream to a channel as its last fallback; when it is on another channel (`from`), it
   * leaves that one first.
   */
  addStream: (channelId: ChannelId, sourceStreamId: SourceStreamId, from?: ChannelId) =>
    Effect.gen(function* () {
      const api = yield* Api;
      if (from !== undefined) {
        const theirs = fallbackOrder(yield* api.channels.streams({ params: { channelId: from } }));
        yield* api.channels.setStreams({
          params: { channelId: from },
          payload: theirs
            .filter((id) => id !== sourceStreamId)
            .map((id, priority): ChannelStreamInput => ({ sourceStreamId: id, priority })),
        });
      }
      const mine = fallbackOrder(yield* api.channels.streams({ params: { channelId } }));
      return yield* api.channels.setStreams({
        params: { channelId },
        payload: [...mine.filter((id) => id !== sourceStreamId), sourceStreamId].map(
          (id, priority): ChannelStreamInput => ({ sourceStreamId: id, priority }),
        ),
      });
    }),
  split: (channelId: ChannelId, sourceStreamId: SourceStreamId) =>
    Effect.flatMap(Api, (api) =>
      api.channels.split({ params: { channelId }, payload: { sourceStreamId } }),
    ),
};
