import type { RecordingEntry } from "@slipstream/api";
import { watchChoiceFor } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import { queryKeys } from "../api/keys.ts";
import { apiActions } from "../api/queries.ts";
import { optionText } from "../player/choice-text.ts";
import { playerParams, type PlayTarget } from "../player/playback.ts";
import { useSession } from "../session/session-context.ts";
import type { IconName } from "../ui/Icon.tsx";
import { useToast } from "../ui/toast.ts";

/** One way to start watching a recording. */
export interface PlayRow {
  readonly key: string;
  readonly icon: IconName;
  readonly title: string;
  readonly target: PlayTarget;
}

/**
 * How a recording starts playing: the watch choice's options (Resume, From start, Watch live
 * while it records), or one Play when there is nothing to ask. Nothing for a failed or
 * scheduled recording.
 */
export const playRows = (entry: RecordingEntry, now: number): readonly PlayRow[] => {
  const recording = (from: "start" | "resume" | "live"): PlayTarget => ({
    _tag: "Recording",
    recordingId: entry.id,
    from,
  });
  const choice = watchChoiceFor(entry, now);
  if (choice === undefined) return [];
  if (choice.direct) {
    return [{ key: "play", icon: "play", title: m.player_play(), target: recording("start") }];
  }
  return choice.options.map((option) => {
    const text = optionText(option, choice, now);
    return {
      key: option.kind,
      icon: text.icon,
      title: text.title,
      target: recording(option.kind),
    };
  });
};

/**
 * What can be done to a recording from its sheet or its page: play it, protect it, delete it.
 * `onLeave` runs before playback opens and after a delete, so a sheet can close or a page go
 * back; a toast says what happened.
 */
export const useRecordingActions = (entry: RecordingEntry, onLeave: () => void) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { runAction } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.continueWatching }),
    ]);
  const failedToast = () => toast({ text: m.library_action_failed() });
  return {
    busy,
    play: (target: PlayTarget) => {
      onLeave();
      router.push({ pathname: "/player", params: playerParams(target) });
    },
    protect: () => {
      if (busy) return;
      setBusy(true);
      const next = !entry.protected;
      void Haptics.selectionAsync();
      runAction(apiActions.updateRecording(entry.id, { protected: next }))
        .then(refresh)
        .then(() =>
          toast({ text: next ? m.library_protected_toast() : m.library_unprotected_toast() }),
        )
        .catch(failedToast)
        .finally(() => setBusy(false));
    },
    remove: () => {
      if (busy) return;
      setBusy(true);
      runAction(apiActions.deleteRecording(entry.id))
        .then(() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onLeave();
          toast({ text: m.library_deleted({ title: entry.title }) });
          return refresh();
        })
        .catch(failedToast)
        .finally(() => setBusy(false));
    },
  };
};
