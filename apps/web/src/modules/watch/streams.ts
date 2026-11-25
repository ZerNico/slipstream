import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "effect";
import type { SourceStreams, StreamUse } from "@slipstream/api";
import type { Channel, ChannelId, PlaybackSessionId, SourceId } from "@slipstream/domain";
import { streamHeadroom } from "@slipstream/domain";
import { useApi, useQueries } from "~/api/hooks.ts";
import { keys } from "~/api/queries.ts";
import { m } from "@slipstream/i18n";

/*
 * The streams group (SPEC §7.9), which the player error reads to name who watches on the full
 * source and offer "Stop arte on Kitchen Shield".
 */

/**
 * The stream use the player error needs, only while it is shown. A failed read leaves the
 * error with the reason's own words and no one to name.
 */
export function useStreams(enabled: boolean) {
  return useQuery({ ...useQueries().streams(), enabled });
}

/** Stops someone's live stream to free it (own, household viewers, or anyone for admins). */
export function useStopWatching() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (playbackSessionId: PlaybackSessionId) =>
      api.call((c) => c.streams.stopWatching({ params: { playbackSessionId } })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.streams }),
  });
}

/** One live viewer the error can offer to stop. */
export interface Watcher {
  readonly playbackSessionId: PlaybackSessionId;
  readonly channelId: ChannelId;
  readonly deviceName: string | undefined;
}

/**
 * Who watches on the source that refused (SPEC §7.9), newest first: the first one is the fix
 * the error offers. Undefined when the source has no limit or is unknown.
 */
export const sourceWatchers = (
  sources: readonly SourceStreams[],
  sourceId: SourceId | undefined,
): readonly Watcher[] | undefined => {
  const source =
    sources.find((candidate) => candidate.sourceId === sourceId) ??
    (sourceId === undefined
      ? sources.find((candidate) => streamHeadroom(candidate.counts).atLimit)
      : undefined);
  if (!source || source.counts.maxStreams === undefined) return undefined;
  return source.uses
    .filter((inUse): inUse is Extract<StreamUse, { _tag: "Watching" }> => inUse._tag === "Watching")
    .toSorted((a, b) => DateTime.toEpochMillis(b.since) - DateTime.toEpochMillis(a.since))
    .map((inUse) => ({
      playbackSessionId: inUse.playbackSessionId,
      channelId: inUse.channelId,
      deviceName: inUse.deviceName,
    }));
};

/** "arte on Kitchen Shield", or just "arte" when the device has no name. */
export const watcherName = (watcher: Watcher, channels: readonly Channel[]): string => {
  const channel =
    channels.find((candidate) => candidate.id === watcher.channelId)?.name ?? watcher.channelId;
  return watcher.deviceName === undefined
    ? channel
    : m.player_watcher({ channel, device: watcher.deviceName });
};
