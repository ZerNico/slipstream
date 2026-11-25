import type { RecordingEntry } from "@slipstream/api";
import {
  type ChannelId,
  extendedEnd,
  extendPadding,
  type GuideEntry,
  recordNowNote,
  recordNowState,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useCreateRecording, useStopRecording, useUpdateRecording } from "~/api/mutations.ts";
import { useViewer } from "~/api/viewer.ts";
import { recordedSpan } from "~/modules/library/library.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { toast } from "~/ui/toast-manager.ts";
import type { PlayerPosition } from "./player-model.ts";

/*
 * Record in the player: one press records the programme on air at the playhead, keeping what
 * the channel's capture already holds of it; while it records, Extend and Stop instead.
 */

/** Where the playhead is when the control is drawn or pressed. */
export interface RecordAt {
  /** The playhead, wall clock (epoch ms). */
  readonly atMs: number;
  /** The first second the pause buffer holds, when known. */
  readonly capturedFromMs: number | undefined;
  /** Playing at the live edge (or not loaded yet). */
  readonly atLive: boolean;
}

/** The Record control for the playhead's programme. */
export type RecordControl =
  | {
      readonly kind: "record";
      readonly busy: boolean;
      readonly onRecord: () => void;
      readonly onOptions: () => void;
    }
  | {
      readonly kind: "recording";
      readonly busy: boolean;
      /** "Recording until 20:30". */
      readonly until: string;
      readonly onExtend: () => void;
      readonly onStop: () => void;
      readonly onOptions: (() => void) | undefined;
    };

/** What a player page hands the player: the control at a playhead, or none at all. */
export type RecordNow = (at: RecordAt) => RecordControl | undefined;

/** Tells the viewer Extend, Stop or Record didn't go through, as the programme sheet does. */
const failed = () => {
  toast({ title: m.guide_action_failed(), type: "error" });
};

/** Extend by one step and Stop for a running recording, the same everywhere in the player. */
export function useRecordingActions() {
  const update = useUpdateRecording();
  const stop = useStopRecording();
  return {
    busy: update.isPending || stop.isPending,
    extend: (entry: RecordingEntry) => {
      const end = extendedEnd(entry, entry.padding);
      update.mutate(
        { id: entry.id, update: { padding: extendPadding(entry.padding) } },
        {
          onSuccess: () => toast({ title: m.player_recording_extended({ end: new Date(end) }) }),
          onError: failed,
        },
      );
    },
    stop: (entry: RecordingEntry) =>
      stop.mutate(entry.id, {
        onSuccess: () => toast({ title: m.player_recording_stopped() }),
        onError: failed,
      }),
  };
}

/**
 * The Record control for a player page. On a channel: the programme at the playhead in
 * `programmes` (`recordNowState`); `playing` is the recording the page plays, which is the
 * control's while it runs. Undefined for a profile that may not record.
 */
export function useRecordNow(input: {
  readonly channelId: ChannelId | undefined;
  readonly programmes: readonly GuideEntry[];
  readonly recordings: readonly RecordingEntry[];
  readonly playing?: RecordingEntry | undefined;
  /** Record was pressed at `at`; the request is on its way. */
  readonly onPressed?: (at: RecordAt) => void;
}): RecordNow | undefined {
  const viewer = useViewer();
  const overlay = useOverlay();
  const create = useCreateRecording();
  const actions = useRecordingActions();
  if (!viewer.access.mayRecord) return undefined;
  const optionsFor = (programmeId: string) => () =>
    overlay.open({ kind: "sheet", name: "prog", arg: programmeId });
  const recordingControl = (entry: RecordingEntry): RecordControl => ({
    kind: "recording",
    busy: actions.busy,
    until: m.player_recording_extended({ end: new Date(recordedSpan(entry).end) }),
    onExtend: () => actions.extend(entry),
    onStop: () => actions.stop(entry),
    onOptions: entry.programmeId === undefined ? undefined : optionsFor(entry.programmeId),
  });
  return (at) => {
    const { playing } = input;
    if (playing !== undefined) {
      return playing.state === "recording" ? recordingControl(playing) : undefined;
    }
    if (input.channelId === undefined) return undefined;
    const now = Date.now();
    const state = recordNowState({
      programmes: input.programmes,
      channelId: input.channelId,
      atMs: at.atMs,
      nowMs: now,
      recordings: input.recordings,
    });
    switch (state._tag) {
      case "Unavailable":
        return undefined;
      case "Recording":
        return recordingControl(state.recording);
      case "Record": {
        const { programme } = state;
        return {
          kind: "record",
          busy: create.isPending,
          onOptions: optionsFor(programme.id),
          onRecord: () => {
            if (create.isPending) return;
            const pressedAtMs = Date.now();
            input.onPressed?.(at);
            create.mutate(
              { _tag: "Programme", programmeId: programme.id },
              {
                onSuccess: (entry) => {
                  const note = recordNowNote({
                    recording: entry,
                    capturedFromMs: at.capturedFromMs,
                    pressedAtMs,
                  });
                  const from = new Date(note.fromMs);
                  toast({
                    title: m.guide_recording_started({ title: programme.title }),
                    description:
                      note.earlierMinutes > 0
                        ? m.record_now_from_earlier({ from, minutes: note.earlierMinutes })
                        : m.record_now_from({ from }),
                    type: "recording",
                  });
                },
                onError: () => toast({ title: m.guide_record_failed(), type: "error" }),
              },
            );
          },
        };
      }
    }
  };
}

/** Where the playhead is, for the control: the live edge until the stream has loaded. */
export const recordAt = (position: PlayerPosition | undefined, now: number): RecordAt => ({
  atMs: position?.position ?? now,
  capturedFromMs: position?.timeline.captured?.start,
  atLive: position?.atLive ?? true,
});
