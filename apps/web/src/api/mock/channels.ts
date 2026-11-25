import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentUser, InvalidInput, SlipstreamApi } from "@slipstream/api";
import {
  canSeeChannel,
  type Channel,
  ChannelId,
  channelPairKey,
  guideChannelOrder,
  mergeSuggestions,
  type NumberChange,
  placeNumbers,
} from "@slipstream/domain";
import { type MockContext, notFound, notInMock, requireAdmin } from "./context.ts";
import { accessOf } from "./household.ts";
import { lineupOf, linksOf } from "./lineup.ts";

/**
 * The mock's `channels` group: the channels the caller may see, and their settings: numbers
 * (a taken number moves its holder to the next free one), streams in fallback order, guide
 * mapping, split and the gentle remove that cancels one-offs still scheduled on the channel.
 */
export const channelsGroup = (ctx: MockContext) => {
  const { data } = ctx;
  const lineup = () => lineupOf(data);
  const findChannel = (id: string) =>
    Effect.suspend(() => {
      const found = data.channels.find((c) => c.id === id);
      return found === undefined ? notFound("channel", id) : Effect.succeed(found);
    });
  const applyNumbers = (changes: ReadonlyArray<NumberChange>) => {
    const numbers = new Map(changes.map((change) => [change.id, change.number]));
    data.channels = data.channels
      .map((c) => {
        const number = numbers.get(c.id);
        return number === undefined ? c : { ...c, number };
      })
      .toSorted(guideChannelOrder);
    return data.channels;
  };
  const scheduledOn = (ids: ReadonlySet<string>) =>
    data.recordings.filter(
      (r) => ids.has(r.channelId) && r.state === "scheduled" && r.ruleId === undefined,
    );
  const checkIds = (ids: ReadonlyArray<string>) =>
    Effect.forEach(ids, findChannel, { discard: true });
  // Pairs said not to be the same ("Not the same", or a split).
  const apart = new Set<string>();
  const sourceName = (streamId: string) => {
    const stream = data.streams.find((s) => s.id === streamId);
    return data.sources.find((source) => source.id === stream?.sourceId)?.name ?? "";
  };

  return HttpApiBuilder.group(SlipstreamApi, "channels", (handlers) =>
    handlers
      .handle("list", ({ query }) =>
        Effect.gen(function* () {
          const access = accessOf(data, yield* CurrentUser);
          return data.channels.filter(
            (c) => (query.includeHidden || !c.hidden) && canSeeChannel(access, c.id),
          );
        }),
      )
      .handle("get", ({ params }) => findChannel(params.channelId))
      .handle("create", () => notInMock)
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const found = yield* findChannel(params.channelId);
          const { logoUrl, number, guideChannelId, ...rest } = payload;
          const { guideChannelId: _guide, ...unmapped } = { ...found, ...rest };
          const kept: Channel =
            guideChannelId === null
              ? unmapped
              : { ...found, ...rest, ...(guideChannelId === undefined ? {} : { guideChannelId }) };
          const { logoUrl: _old, ...withoutLogo } = kept;
          const updated: Channel =
            logoUrl === null ? withoutLogo : logoUrl === undefined ? kept : { ...kept, logoUrl };
          data.channels = data.channels.map((c) => (c.id === found.id ? updated : c));
          if (number !== undefined) applyNumbers(placeNumbers(data.channels, [found.id], number));
          return data.channels.find((c) => c.id === found.id) ?? updated;
        }),
      )
      .handle("setNumber", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const found = yield* findChannel(params.channelId);
          return applyNumbers(placeNumbers(data.channels, [found.id], payload.number));
        }),
      )
      .handle("placeNumbers", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          yield* checkIds(payload.ids);
          return applyNumbers(placeNumbers(data.channels, payload.ids, payload.start));
        }),
      )
      .handle("removePreview", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          yield* checkIds(payload.ids);
          return { scheduledRecordings: scheduledOn(new Set(payload.ids)).length };
        }),
      )
      .handle("removeMany", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          yield* checkIds(payload.ids);
          const ids = new Set<string>(payload.ids);
          const cancelled = new Set(scheduledOn(ids).map((r) => r.id));
          data.recordings = data.recordings.map((r) =>
            cancelled.has(r.id) ? { ...r, state: "cancelled" } : r,
          );
          data.channels = data.channels.filter((c) => !ids.has(c.id));
          for (const id of payload.ids) lineup().links.delete(id);
        }),
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          yield* findChannel(params.channelId);
          data.channels = data.channels.filter((c) => c.id !== params.channelId);
          lineup().links.delete(params.channelId);
        }),
      )
      .handle("mergePreview", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const keep = yield* findChannel(payload.keepId);
          const others = yield* Effect.forEach(payload.otherIds, findChannel);
          const ids = new Set<string>(payload.otherIds);
          return {
            keep,
            others,
            streams: others.reduce((sum, c) => sum + (lineup().links.get(c.id)?.length ?? 0), 0),
            recordings: data.recordings.filter((r) => ids.has(r.channelId)).length,
            seriesRecordings: data.rules.filter((r) => r.matcher.channels.some((id) => ids.has(id)))
              .length,
            collections: data.collections.filter((c) =>
              c.matcher.channels.some((id) => ids.has(id)),
            ).length,
          };
        }),
      )
      .handle("merge", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const keep = yield* findChannel(payload.keepId);
          yield* checkIds(payload.otherIds);
          const ids = new Set<string>(payload.otherIds);
          const streams = [keep.id, ...payload.otherIds].flatMap(
            (id) => lineup().links.get(id) ?? [],
          );
          lineup().links.set(keep.id, [...new Set(streams)]);
          for (const id of payload.otherIds) lineup().links.delete(id);
          data.recordings = data.recordings.map((r) =>
            ids.has(r.channelId) ? { ...r, channelId: keep.id } : r,
          );
          data.channels = data.channels.filter((c) => !ids.has(c.id));
          return keep;
        }),
      )
      .handle("keepApart", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const ids = [...new Set(payload.ids)];
          if (ids.length < 2) {
            return yield* Effect.fail(
              new InvalidInput({ problems: [{ path: "ids", code: "tooFew" }] }),
            );
          }
          yield* checkIds(ids);
          for (const [index, a] of ids.entries()) {
            for (const b of ids.slice(index + 1)) apart.add(channelPairKey(a, b));
          }
        }),
      )
      .handle("split", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const found = yield* findChannel(params.channelId);
          const ids = lineup().links.get(found.id) ?? [];
          if (!ids.includes(payload.sourceStreamId) || ids.length < 2) {
            return yield* Effect.fail(
              new InvalidInput({ problems: [{ path: "sourceStreamId", code: "onlyStream" }] }),
            );
          }
          const stream = data.streams.find((s) => s.id === payload.sourceStreamId);
          const taken = new Set(
            data.channels.flatMap((c) => (c.number === undefined ? [] : [c.number])),
          );
          const channel: Channel = {
            id: ChannelId.make(`split-${payload.sourceStreamId}`),
            name: stream?.name ?? found.name,
            number: Math.max(0, ...taken) + 1,
            favourite: false,
            hidden: false,
          };
          lineup().links.set(
            found.id,
            ids.filter((id) => id !== payload.sourceStreamId),
          );
          lineup().links.set(channel.id, [payload.sourceStreamId]);
          apart.add(channelPairKey(found.id, channel.id));
          data.channels = [...data.channels, channel].toSorted(guideChannelOrder);
          return channel;
        }),
      )
      .handle("review", () =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const suggestions = mergeSuggestions(
            data.channels.map((c) => ({
              id: c.id,
              name: c.name,
              guideIds: c.guideChannelId === undefined ? [] : [c.guideChannelId],
            })),
            apart,
          );
          return {
            mergeSuggestions: suggestions.map((suggestion) => ({
              channels: suggestion.channelIds.flatMap((id) => {
                const c = data.channels.find((candidate) => candidate.id === id);
                if (c === undefined) return [];
                return [
                  {
                    id: c.id,
                    name: c.name,
                    ...(c.number === undefined ? {} : { number: c.number }),
                    ...(c.logoUrl === undefined ? {} : { logoUrl: c.logoUrl }),
                    streams: (lineup().links.get(c.id) ?? []).map((streamId) => ({
                      name: data.streams.find((s) => s.id === streamId)?.name ?? streamId,
                      sourceName: sourceName(streamId),
                    })),
                  },
                ];
              }),
              reason: suggestion.reason,
            })),
            sources: data.sources.map((source) => ({
              sourceId: source.id,
              name: source.name,
              newStreams: 0,
              goneStreams: 0,
            })),
            goneStreams: [],
            withoutStreams: data.channels
              .filter((c) => (lineup().links.get(c.id) ?? []).length === 0)
              .map((c) => ({ id: c.id, name: c.name })),
          };
        }),
      )
      .handle("guideChannels", ({ query }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const term = query.search?.trim().toLowerCase() ?? "";
          return lineup()
            .guideChannels.filter(
              (g) =>
                term === "" ||
                g.displayName.toLowerCase().includes(term) ||
                g.xmltvId.toLowerCase().includes(term),
            )
            .map((g) => ({
              ...g,
              channels: data.channels.filter((c) => c.guideChannelId === g.xmltvId).length,
            }));
        }),
      )
      .handle("guideSuggestions", ({ params }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const found = yield* findChannel(params.channelId);
          const word = found.name.split(/\s+/u)[0]?.toLowerCase() ?? "";
          return lineup()
            .guideChannels.filter((g) => g.displayName.toLowerCase().includes(word))
            .map((g) => ({ ...g, reason: "similarName" as const }));
        }),
      )
      .handle("streams", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* findChannel(params.channelId);
          return linksOf(lineup(), found.id);
        }),
      )
      .handle("setStreams", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const found = yield* findChannel(params.channelId);
          lineup().links.set(
            found.id,
            payload.toSorted((a, b) => a.priority - b.priority).map((s) => s.sourceStreamId),
          );
          return linksOf(lineup(), found.id);
        }),
      ),
  );
};
