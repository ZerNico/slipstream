import type { StreamLimitReason } from "@slipstream/api";
import type { Channel, SourceId } from "@slipstream/domain";
import { m, streamLimitText } from "@slipstream/i18n";
import { toast } from "~/ui/toast-manager.ts";
import { PlayerError } from "./player-error.tsx";
import { sourceWatchers, useStopWatching, useStreams, watcherName } from "./streams.ts";

/**
 * "No free stream for watching" (SPEC §7.1, §7.9): the title and hint every client shows for
 * the reason (`streamLimitText`). Where the source is full and the streams read answers, the
 * body names who watches on it instead, and the first fix stops the newest viewer and tries
 * again.
 */
export function LimitError({
  reason,
  sourceId,
  channelName,
  channels,
  retry,
  back,
}: {
  reason: StreamLimitReason;
  sourceId?: SourceId | undefined;
  channelName: string;
  channels: readonly Channel[];
  retry: () => void;
  back: "guide" | "recordings";
}) {
  const streams = useStreams(reason === "sourceFull");
  const stop = useStopWatching();
  const text = streamLimitText(reason);

  if (reason === "profileLimit") {
    return <PlayerError title={text.title} body={text.body} onRetry={retry} back={back} />;
  }
  const watchers = streams.data ? sourceWatchers(streams.data, sourceId) : undefined;
  const names = watchers?.map((watcher) => watcherName(watcher, channels)) ?? [];
  const first = watchers?.[0];
  const firstName = names[0];
  const body =
    watchers === undefined
      ? text.body
      : names.length > 0
        ? m.player_limit_in_use({ count: names.length, watchers: names, channel: channelName })
        : undefined;
  return (
    <PlayerError
      title={text.title}
      {...(body === undefined ? {} : { body })}
      {...(first !== undefined && firstName !== undefined
        ? {
            fix: {
              label: m.player_stop_watcher({ watcher: firstName }),
              busy: stop.isPending,
              onClick: () => {
                stop.mutate(first.playbackSessionId, {
                  onSuccess: () => {
                    toast({ title: m.player_stopped_watcher({ watcher: firstName }) });
                    retry();
                  },
                  onError: () => {
                    toast({ title: text.body, type: "error" });
                  },
                });
              },
            },
          }
        : {})}
      onRetry={retry}
      back={back}
    />
  );
}
