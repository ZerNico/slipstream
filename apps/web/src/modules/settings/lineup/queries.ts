import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChannelStreamInput } from "@slipstream/api";
import type {
  Channel,
  ChannelId,
  ChannelUpdate,
  SourceId,
  SourceStreamId,
} from "@slipstream/domain";
import type { Api } from "~/api/client.ts";
import { useApi } from "~/api/hooks.ts";
import { invalidateFor } from "~/api/invalidation.ts";
import { keys } from "~/api/queries.ts";

/*
 * The lineup's reads and writes. Every key sits under `channels`, so any channel change (here,
 * from another screen or a live event) refetches them with the lineup.
 */

const lineupKeys = {
  /** The streams of one source that belong to a channel, for rows, filters and stream names. */
  added: (sourceId: SourceId) => [...keys.channels, "added", sourceId] as const,
  streams: (id: ChannelId) => [...keys.channels, "streams", id] as const,
  guideSuggestions: (id: ChannelId) => [...keys.channels, "guide-suggestions", id] as const,
  guideChannels: (search: string) => [...keys.channels, "guide-channels", search] as const,
  removePreview: (ids: readonly ChannelId[]) =>
    [...keys.channels, "remove-preview", ids.join(",")] as const,
};

/** The most streams one source lists in one page; a lineup source fits in one. */
const ALL_STREAMS = 5000;

/** The lineup's read options for one {@link Api}. */
export const lineupQueries = (api: Api) => ({
  added: (sourceId: SourceId) =>
    queryOptions({
      queryKey: lineupKeys.added(sourceId),
      queryFn: () =>
        api.call((c) =>
          c.sources.catalogue({
            params: { sourceId },
            query: { filter: "added", limit: ALL_STREAMS },
          }),
        ),
      staleTime: 60_000,
    }),
  streams: (id: ChannelId) =>
    queryOptions({
      queryKey: lineupKeys.streams(id),
      queryFn: () => api.call((c) => c.channels.streams({ params: { channelId: id } })),
    }),
  guideSuggestions: (id: ChannelId) =>
    queryOptions({
      queryKey: lineupKeys.guideSuggestions(id),
      queryFn: () => api.call((c) => c.channels.guideSuggestions({ params: { channelId: id } })),
      staleTime: 60_000,
    }),
  guideChannels: (search: string) =>
    queryOptions({
      queryKey: lineupKeys.guideChannels(search),
      queryFn: () =>
        api.call((c) => c.channels.guideChannels({ query: search === "" ? {} : { search } })),
      staleTime: 60_000,
      placeholderData: (previous) => previous,
    }),
  removePreview: (ids: readonly ChannelId[]) =>
    queryOptions({
      queryKey: lineupKeys.removePreview(ids),
      queryFn: () => api.call((c) => c.channels.removePreview({ payload: { ids: [...ids] } })),
      staleTime: 0,
    }),
});

/** The lineup's read options for this app's API. */
export const useLineupQueries = () => lineupQueries(useApi());

/** Writes the lineup as the server answered it, so numbers move at once, then refetches. */
const useLineupAnswer = () => {
  const client = useQueryClient();
  return {
    onSuccess: (lineup: readonly Channel[]) => {
      client.setQueryData(keys.channels, lineup);
      return client.invalidateQueries({ queryKey: keys.guide });
    },
    onError: () => client.invalidateQueries({ queryKey: keys.channels }),
  };
};

/** Gives one channel a number; the holder of that number moves to the next free one. */
export const useSetNumber = () => {
  const api = useApi();
  return useMutation({
    mutationFn: (input: { readonly id: ChannelId; readonly number: number }) =>
      api.call((c) =>
        c.channels.setNumber({
          params: { channelId: input.id },
          payload: { number: input.number },
        }),
      ),
    ...useLineupAnswer(),
  });
};

/** Gives channels consecutive numbers from `start`, in the given order. */
export const usePlaceNumbers = () => {
  const api = useApi();
  return useMutation({
    mutationFn: (input: { readonly ids: readonly ChannelId[]; readonly start: number }) =>
      api.call((c) =>
        c.channels.placeNumbers({ payload: { ids: [...input.ids], start: input.start } }),
      ),
    ...useLineupAnswer(),
  });
};

/** The same change to several channels (hide, show, favourite), one request each. */
export const useUpdateChannels = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly ids: readonly ChannelId[]; readonly update: ChannelUpdate }) =>
      Promise.all(
        input.ids.map((id) =>
          api.call((c) => c.channels.update({ params: { channelId: id }, payload: input.update })),
        ),
      ),
    onSettled: () => invalidateFor(client, "channels"),
  });
};

/** Removes channels gently: recordings stay, scheduled one-offs on them are cancelled. */
export const useRemoveChannels = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: readonly ChannelId[]) =>
      api.call((c) => c.channels.removeMany({ payload: { ids: [...ids] } })),
    onSettled: () => invalidateFor(client, "channels", "recording"),
  });
};

/** Sets a channel's streams in fallback order (the first is tried first). */
export const useSetStreams = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly id: ChannelId; readonly streams: readonly SourceStreamId[] }) =>
      api.call((c) =>
        c.channels.setStreams({
          params: { channelId: input.id },
          payload: input.streams.map((sourceStreamId, priority): ChannelStreamInput => ({
            sourceStreamId,
            priority,
          })),
        }),
      ),
    onSuccess: (streams, input) => client.setQueryData(lineupKeys.streams(input.id), streams),
    onSettled: () => invalidateFor(client, "channels"),
  });
};

/** Takes one stream out of a channel into a channel of its own. */
export const useSplitChannel = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly id: ChannelId; readonly sourceStreamId: SourceStreamId }) =>
      api.call((c) =>
        c.channels.split({
          params: { channelId: input.id },
          payload: { sourceStreamId: input.sourceStreamId },
        }),
      ),
    onSettled: () => invalidateFor(client, "channels"),
  });
};
