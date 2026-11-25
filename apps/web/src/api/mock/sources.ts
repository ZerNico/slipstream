import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { InvalidInput, SlipstreamApi, type SourceStreamEntry } from "@slipstream/api";
import {
  applySecretHeadersPatch,
  applySourceConfigPatch,
  type Channel,
  ChannelId,
  groupVariants,
  qualityRank,
  type Source,
  SourceId,
  type SourceStream,
  streamQuality,
  viewSource,
  viewSourceStream,
} from "@slipstream/domain";
import { type MockContext, notFound, notInMock, now, requireAdmin } from "./context.ts";
import { channelOfStream, lineupOf, linkStream } from "./lineup.ts";

/**
 * The mock's `sources` group: IPTV sources, testing and refreshing them.
 * The shared state is in context.ts.
 */
export const sourcesGroup = (ctx: MockContext) => {
  const { data, publish } = ctx;
  const findSource = (id: SourceId) =>
    Effect.suspend(() => {
      const source = data.sources.find((s) => s.id === id);
      return source ? Effect.succeed(source) : notFound("source", id);
    });

  // Which channel each stream is added to: the lineup's links, which the channels group shares.
  const lineup = () => lineupOf(data);
  const ignored = new Set<string>();
  const guideIds = () => new Set(data.channels.flatMap((channel) => channel.guideChannelId ?? []));
  const entry = (stream: SourceStream, known: ReadonlySet<string>): SourceStreamEntry => {
    const quality = streamQuality(stream.name);
    const channelId = channelOfStream(lineup(), stream.id);
    const channel = data.channels.find((candidate) => candidate.id === channelId);
    const match =
      channel === undefined && stream.tvgId !== undefined
        ? data.channels.find((candidate) => candidate.guideChannelId === stream.tvgId)
        : undefined;
    return {
      id: stream.id,
      name: stream.name,
      ...(stream.group === undefined ? {} : { group: stream.group }),
      ...(stream.tvgId === undefined ? {} : { tvgId: stream.tvgId }),
      quality,
      qualityRank: qualityRank(quality),
      hasGuide: stream.tvgId !== undefined && known.has(stream.tvgId),
      ...(channel === undefined ? {} : { channel: { id: channel.id, name: channel.name } }),
      ...(match === undefined
        ? {}
        : { match: { channelId: match.id, name: match.name, reason: "sameGuide" as const } }),
      new: false,
      ignored: ignored.has(stream.id),
      gone: false,
    };
  };
  const ofSource = (id: SourceId) =>
    data.streams
      .filter((stream) => stream.sourceId === id)
      .toSorted(
        (a, b) =>
          (a.group ?? "\uffff").localeCompare(b.group ?? "\uffff") || a.name.localeCompare(b.name),
      );

  return HttpApiBuilder.group(SlipstreamApi, "sources", (handlers) =>
    handlers
      .handle("list", () => Effect.sync(() => data.sources.map(viewSource)))
      .handle("get", () => notInMock)
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const source: Source = {
            ...payload,
            id: SourceId.make(crypto.randomUUID()),
            health: "unknown",
          };
          data.sources = [...data.sources, source];
          return viewSource(source);
        }),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const source = yield* findSource(params.sourceId);
          const { config: configPatch, secretHeaders: headersPatch, ...rest } = payload;
          const config =
            configPatch === undefined
              ? source.config
              : applySourceConfigPatch(source.config, configPatch);
          if (config._tag === "MissingSecret") {
            return yield* Effect.fail(
              new InvalidInput({ problems: [{ path: `config.${config.field}`, code: "missing" }] }),
            );
          }
          const secretHeaders =
            headersPatch === undefined
              ? source.secretHeaders
              : applySecretHeadersPatch(source.secretHeaders, headersPatch);
          const updated: Source = {
            ...source,
            ...rest,
            config,
            ...(secretHeaders === undefined ? {} : { secretHeaders }),
          };
          data.sources = data.sources.map((s) => (s.id === source.id ? updated : s));
          return viewSource(updated);
        }),
      )
      .handle("remove", () => notInMock)
      .handle("refresh", ({ params }) =>
        Effect.gen(function* () {
          const source = yield* findSource(params.sourceId);
          const refreshed = { ...source, lastRefreshAt: now() };
          data.sources = data.sources.map((s) => (s.id === source.id ? refreshed : s));
          publish({ _tag: "GuideRefreshed", sourceId: source.id });
          return {
            streams: data.streams.filter((s) => s.sourceId === source.id).length,
            guideChannels: data.channels.length,
            programmes: data.programmes.length,
            unmappedStreams: 0,
            checkedAt: now(),
          };
        }),
      )
      .handle("test", () =>
        Effect.sync(() => ({
          streams: data.streams.length,
          guideChannels: data.channels.length,
          programmes: data.programmes.length,
          unmappedStreams: 1,
          checkedAt: now(),
        })),
      )
      .handle("streams", ({ params }) =>
        Effect.sync(() =>
          data.streams.filter((s) => s.sourceId === params.sourceId).map(viewSourceStream),
        ),
      )
      .handle("catalogue", ({ params, query }) =>
        Effect.gen(function* () {
          yield* findSource(params.sourceId);
          const known = guideIds();
          const term = query.search?.trim().toLowerCase() ?? "";
          const all = ofSource(params.sourceId)
            .map((stream) => entry(stream, known))
            .filter(
              (stream) =>
                (query.group === undefined || (stream.group ?? "") === query.group) &&
                (term === "" || stream.name.toLowerCase().includes(term)) &&
                (query.filter === undefined ||
                  query.filter === "all" ||
                  (query.filter === "added" && stream.channel !== undefined) ||
                  (query.filter === "notAdded" &&
                    stream.channel === undefined &&
                    !stream.ignored) ||
                  (query.filter === "new" && stream.new) ||
                  (query.filter === "ignored" && stream.ignored)),
            );
          const offset = query.offset ?? 0;
          return {
            total: all.length,
            streams: all.slice(offset, offset + Math.min(query.limit ?? 500, 5000)),
          };
        }),
      )
      .handle("groups", ({ params }) =>
        Effect.gen(function* () {
          yield* findSource(params.sourceId);
          const known = guideIds();
          const groups = new Map<
            string,
            {
              name: string | undefined;
              streams: number;
              withGuide: number;
              added: number;
              ignored: number;
            }
          >();
          for (const stream of ofSource(params.sourceId).map((item) => entry(item, known))) {
            const key = stream.group ?? "";
            const counts = groups.get(key) ?? {
              name: stream.group,
              streams: 0,
              withGuide: 0,
              added: 0,
              ignored: 0,
            };
            counts.streams += 1;
            if (stream.hasGuide) counts.withGuide += 1;
            if (stream.channel !== undefined) counts.added += 1;
            if (stream.ignored) counts.ignored += 1;
            groups.set(key, counts);
          }
          return [...groups.values()].map(({ name, ...counts }) => ({
            ...(name === undefined ? {} : { name }),
            ...counts,
            guideCoverage: Math.round((counts.withGuide / counts.streams) * 100),
            new: 0,
          }));
        }),
      )
      .handle("addStreams", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          yield* findSource(params.sourceId);
          const wanted = new Set<string>(payload.streamIds);
          const fresh = data.streams.filter(
            (stream) => wanted.has(stream.id) && channelOfStream(lineup(), stream.id) === undefined,
          );
          const created: Channel[] = [];
          const joined: Array<{
            sourceStreamId: SourceStream["id"];
            channel: { id: ChannelId; name: string };
          }> = [];
          for (const group of groupVariants(fresh)) {
            const target = group
              .map((stream) =>
                data.channels.find(
                  (channel) =>
                    stream.tvgId !== undefined && channel.guideChannelId === stream.tvgId,
                ),
              )
              .find((channel) => channel !== undefined);
            if (target !== undefined) {
              for (const stream of group) {
                linkStream(lineup(), target.id, stream.id);
                joined.push({
                  sourceStreamId: stream.id,
                  channel: { id: target.id, name: target.name },
                });
              }
              continue;
            }
            const [best] = group;
            if (best === undefined) continue;
            const channel: Channel = {
              id: ChannelId.make(`ch-${best.id}`),
              name: best.name,
              number: data.channels.length + 1,
              ...(best.tvgId === undefined ? {} : { guideChannelId: best.tvgId }),
              favourite: false,
              hidden: false,
            };
            data.channels = [...data.channels, channel];
            for (const stream of group) linkStream(lineup(), channel.id, stream.id);
            created.push(channel);
          }
          for (const id of wanted) ignored.delete(id);
          return { created, joined };
        }),
      )
      .handle("ignoreStreams", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          yield* findSource(params.sourceId);
          for (const id of payload.streamIds) {
            if (payload.ignored) ignored.add(id);
            else ignored.delete(id);
          }
        }),
      )
      .handle("markReviewed", ({ params }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const source = yield* findSource(params.sourceId);
          const reviewed = { ...source, reviewedAt: now() };
          data.sources = data.sources.map((s) => (s.id === source.id ? reviewed : s));
          return viewSource(reviewed);
        }),
      ),
  );
};
