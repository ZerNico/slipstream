import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { SlipstreamApi, type SourceStreams, type StreamUse } from "@slipstream/api";
import { type MockContext, notFound } from "./context.ts";

/**
 * The mock's `streams` group (SPEC §7.9): every source's stream budget and what uses it.
 * Running recordings use their channel's source; the mock knows no live viewers yet, so
 * watching is 0.
 */
export const streamsGroup = (ctx: MockContext) => {
  const { data } = ctx;
  const list = (): readonly SourceStreams[] =>
    data.sources.map((source) => {
      const channels = new Set(
        data.streams.filter((stream) => stream.sourceId === source.id).map((s) => s.upstreamId),
      );
      const uses: StreamUse[] = data.recordings
        .filter((entry) => entry.state === "recording" && channels.has(entry.channelId))
        .map((entry) => ({
          _tag: "Recording",
          channelId: entry.channelId,
          recordingId: entry.id,
          since: entry.start,
        }));
      return {
        sourceId: source.id,
        name: source.name,
        counts: {
          ...(source.maxStreams === undefined ? {} : { maxStreams: source.maxStreams }),
          keptForRecordings: source.keptForRecordings ?? 0,
          recording: uses.length,
          watching: 0,
        },
        uses,
      };
    });
  return HttpApiBuilder.group(SlipstreamApi, "streams", (handlers) =>
    handlers
      .handle("list", () => Effect.sync(list))
      .handle("stopWatching", ({ params }) =>
        // No live viewers in the mock, so there is never a session to stop.
        notFound("playbackSession", params.playbackSessionId),
      ),
  );
};
