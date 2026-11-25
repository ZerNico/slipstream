import type {
  ChannelId,
  ChannelUpdate,
  SourceId,
  SourceInput,
  SourceStreamId,
  SourceUpdate,
} from "@slipstream/domain";
import { Effect } from "effect";
import { Api } from "../../../api/client.ts";

/* The writes of Settings › Sources on the phone; their reads are shared. */

/** The section's writes, as effects for `runAction`. */
export const sourceActions = {
  createSource: (input: SourceInput) =>
    Effect.flatMap(Api, (api) => api.sources.create({ payload: input })),
  updateSource: (sourceId: SourceId, update: SourceUpdate) =>
    Effect.flatMap(Api, (api) => api.sources.update({ params: { sourceId }, payload: update })),
  deleteSource: (sourceId: SourceId) =>
    Effect.flatMap(Api, (api) => api.sources.remove({ params: { sourceId } })),
  refreshSource: (sourceId: SourceId) =>
    Effect.flatMap(Api, (api) => api.sources.refresh({ params: { sourceId } })),
  /** Fetches a new source's playlist and guide before anything is saved. */
  testSource: (input: SourceInput) =>
    Effect.flatMap(Api, (api) => api.sources.test({ payload: input })),
  /**
   * Adds picked streams as channels (copies become one, guide matches join), then marks the
   * source reviewed, so what was just looked at is no longer new.
   */
  addStreams: (sourceId: SourceId, streamIds: readonly SourceStreamId[]) =>
    Effect.gen(function* () {
      const api = yield* Api;
      const added =
        streamIds.length === 0
          ? { created: [], joined: [] }
          : yield* api.sources.addStreams({ params: { sourceId }, payload: { streamIds } });
      yield* api.sources.markReviewed({ params: { sourceId } });
      return added;
    }),
  updateChannel: (channelId: ChannelId, update: ChannelUpdate) =>
    Effect.flatMap(Api, (api) => api.channels.update({ params: { channelId }, payload: update })),
};
