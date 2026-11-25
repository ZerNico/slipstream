import type { QueryClient } from "@tanstack/react-query";
import type { RecordingEntry, ServerEvent } from "@slipstream/api";
import type { SourceView } from "@slipstream/domain";
import { invalidateFor } from "./invalidation.ts";
import { keys } from "./queries.ts";

/**
 * Applies one live event to the cache. What the event fully describes (a recording's state, a
 * source's health) is patched in place so badges change at once; everything the change reaches
 * is then refetched in the background, from the same table the writes use ({@link invalidateFor}).
 * `Connected` carries no data: `useServerEvents` refetches after a gap when it arrives.
 */
export const applyServerEvent = (client: QueryClient, event: ServerEvent): void => {
  switch (event._tag) {
    case "Connected":
      return;
    case "RecordingChanged": {
      const patch = (entry: RecordingEntry): RecordingEntry =>
        entry.id === event.recordingId ? { ...entry, state: event.state } : entry;
      client.setQueryData<readonly RecordingEntry[]>(keys.recordingList, (list) =>
        list?.map(patch),
      );
      client.setQueryData<RecordingEntry>(keys.recording(event.recordingId), (entry) =>
        entry ? patch(entry) : entry,
      );
      void invalidateFor(client, "recording");
      return;
    }
    case "RecordingReplaced":
      // The damaged original is hidden now: drop it from the list at once.
      client.setQueryData<readonly RecordingEntry[]>(keys.recordingList, (list) =>
        list?.filter((entry) => entry.id !== event.replacedId),
      );
      void invalidateFor(client, "recordingReplaced");
      return;
    case "RecordingRemoved":
      // The row is gone: drop it from the list and forget its detail and resume point at once,
      // so a co-owner's open library or detail view loses it without waiting for a refetch.
      client.setQueryData<readonly RecordingEntry[]>(keys.recordingList, (list) =>
        list?.filter((entry) => entry.id !== event.recordingId),
      );
      client.removeQueries({ queryKey: keys.recording(event.recordingId), exact: true });
      client.removeQueries({ queryKey: keys.playbackState(event.recordingId), exact: true });
      void invalidateFor(client, "recordingRemoved");
      return;
    case "CaptureChanged":
      void invalidateFor(client, "captures");
      return;
    case "SourceHealthChanged":
      client.setQueryData<readonly SourceView[]>(keys.sources, (list) =>
        list?.map((source) =>
          source.id === event.sourceId ? { ...source, health: event.health } : source,
        ),
      );
      void invalidateFor(client, "sourceHealth");
      return;
    case "GuideRefreshed":
      void invalidateFor(client, "guide");
      return;
  }
};
