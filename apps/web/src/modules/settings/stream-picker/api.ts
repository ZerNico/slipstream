import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SourceStreamEntry } from "@slipstream/api";
import type { SourceId, SourceStreamId } from "@slipstream/domain";
import type { Api } from "~/api/client.ts";
import { useApi } from "~/api/hooks.ts";
import { invalidateFor } from "~/api/invalidation.ts";

/*
 * The stream picker's reads and writes. Keys sit under `sources`, so every source change (and
 * the source events) refetches them.
 */

/** The most streams one catalogue call returns. */
const page = 5000;

export const pickerKeys = {
  catalogue: (id: SourceId) => ["sources", "catalogue", id] as const,
  groups: (id: SourceId) => ["sources", "groups", id] as const,
  newCount: (id: SourceId) => ["sources", "new", id] as const,
};

/** Every stream of a source, in group then name order: pages of 5,000 until all are in. */
export const catalogueQuery = (api: Api, id: SourceId) =>
  queryOptions({
    queryKey: pickerKeys.catalogue(id),
    queryFn: async () => {
      const streams: SourceStreamEntry[] = [];
      for (;;) {
        const answer = await api.call((client) =>
          client.sources.catalogue({
            params: { sourceId: id },
            query: { offset: streams.length, limit: page },
          }),
        );
        streams.push(...answer.streams);
        if (answer.streams.length === 0 || streams.length >= answer.total) return streams;
      }
    },
  });

/** A source's playlist groups with their counts: known before the streams, so nothing moves. */
export const groupsQuery = (api: Api, id: SourceId) =>
  queryOptions({
    queryKey: pickerKeys.groups(id),
    queryFn: () => api.call((client) => client.sources.groups({ params: { sourceId: id } })),
  });

/** How many of a source's streams are new since it was last reviewed. */
export const newCountQuery = (api: Api, id: SourceId) =>
  queryOptions({
    queryKey: pickerKeys.newCount(id),
    queryFn: () =>
      api
        .call((client) =>
          client.sources.catalogue({
            params: { sourceId: id },
            query: { filter: "new", limit: 0 },
          }),
        )
        .then((answer) => answer.total),
  });

/**
 * Adds picked streams as channels (copies become one, guide matches join), then marks the
 * source reviewed, so what was just looked at is no longer new.
 */
export const useAddStreams = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly id: SourceId;
      readonly streamIds: readonly SourceStreamId[];
    }) => {
      const added =
        input.streamIds.length === 0
          ? { created: [], joined: [] }
          : await api.call((c) =>
              c.sources.addStreams({
                params: { sourceId: input.id },
                payload: { streamIds: input.streamIds },
              }),
            );
      await api.call((c) => c.sources.markReviewed({ params: { sourceId: input.id } }));
      return added;
    },
    onSuccess: () => invalidateFor(client, "sources", "channels", "guide"),
  });
};
