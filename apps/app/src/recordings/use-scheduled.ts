import type { RecordingEntry } from "@slipstream/api";
import { type ResolveOption, scheduledDays, shortenedPadding } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { queryKeys } from "../api/keys.ts";
import { apiActions } from "../api/queries.ts";
import { channelNames } from "../data/home.ts";
import { useApiQueries, useConflictWindow } from "../data/hooks.ts";
import { householdZone } from "../data/zone.ts";
import { useSession } from "../session/session-context.ts";
import { useToast } from "../ui/toast.ts";

/** One way out of an overlap, for a recording as the API lists it. */
export type EntryResolveOption = ResolveOption<RecordingEntry>;

/**
 * The Scheduled list on phone and TV, from the same domain reading as the web's tab: scheduled
 * recordings by household day, every item of an overlap flagged, the resolution under the last.
 * It stays loading until the conflicts and the sources settled, so no flag or resolution appears
 * under a row already on screen. A profile that may not read the sources gets the copy without
 * the sources' limit.
 */
export const useScheduled = () => {
  const queries = useApiQueries();
  const recordings = useQuery(queries.recordings());
  const channels = useQuery(queries.channels());
  const range = useConflictWindow();
  const conflicts = useQuery(queries.conflicts(range.from, range.to));
  // The sources' stream limits, for how much room a conflict's copy may claim.
  const sources = useQuery(queries.sources());
  const all: readonly RecordingEntry[] = recordings.data ?? [];
  const days = scheduledDays(all, conflicts.data ?? [], sources.data ?? [], householdZone());
  return {
    all,
    days,
    names: channelNames(channels.data ?? []),
    loading: recordings.isPending || channels.isPending || conflicts.isPending || sources.isPending,
    error: recordings.error ?? channels.error,
    retry: () => {
      void recordings.refetch();
      void channels.refetch();
      void conflicts.refetch();
    },
  };
};

/**
 * The resolution's actions, as the web's: Skip removes a scheduled item, Shorten ends a
 * recording at the start of the overlap by cutting its extra minutes after. A toast says what
 * happened; the recordings and the conflicts are read again. `busy` is the recording in work.
 */
export const useResolve = () => {
  const queryClient = useQueryClient();
  const { runAction } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const pick = (option: EntryResolveOption) => {
    if (busy !== undefined) return;
    setBusy(option.entry.id);
    const { entry } = option;
    const action =
      option.kind === "skip"
        ? apiActions.deleteRecording(entry.id)
        : apiActions.updateRecording(entry.id, { padding: shortenedPadding(option) });
    runAction(action)
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({
          text:
            option.kind === "skip"
              ? m.library_skipped_toast({ title: entry.title })
              : m.library_shortened_toast({ title: entry.title, at: new Date(option.endAt) }),
        });
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
          queryClient.invalidateQueries({ queryKey: queryKeys.conflictsAll }),
        ]);
      })
      .catch(() => toast({ text: m.library_action_failed() }))
      .finally(() => setBusy(undefined));
  };
  return { busy, pick };
};
