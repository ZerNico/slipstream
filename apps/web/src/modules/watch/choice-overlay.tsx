import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type ChoiceOption, epochMs, RecordingId } from "@slipstream/domain";
import { problemOf } from "~/api/errors.ts";
import { useHouseholdTimeZone, useQueries } from "~/api/hooks.ts";
import { formatDuration } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { recordedSpan, recordingTimeline, resumeMillis } from "~/modules/library/library.ts";
import type { OverlayComponentProps } from "~/shell/overlay-host.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { ErrorState } from "~/ui/states.tsx";
import { useNow } from "~/ui/use-now.ts";

import { WatchChoice } from "~/ui/watch-choice/watch-choice.tsx";
import { recordingSubject } from "~/ui/artwork/subjects.ts";
import { slotLine } from "./watch-data.ts";

/**
 * `?choice=<recordingId>` (SPEC §7.6): the watch choice for a recording, opened from anywhere
 * (hero, cards, the recording pill, the palette, the programme sheet's Watch). Picking an option
 * replaces the overlay's history entry with the player, so Back from the player returns to the
 * page, not to the dialog. Closing it any other way (Esc, the scrim, Back) returns focus to
 * the control that opened it. A recording that cannot be read (deleted, or no connection) says
 * so in a small dialog whose one action closes it.
 */
export default function ChoiceOverlay({ open, overlay, onOpenChange }: OverlayComponentProps) {
  useReturnFocus(open);
  const queries = useQueries();
  const controls = useOverlay();
  const now = useNow(1000);
  const recording = useQuery(queries.recording(RecordingId.make(overlay.name)));
  const channels = useQuery(queries.channels());
  const timeZone = useHouseholdTimeZone();
  const entry = recording.data;

  if (recording.isError) {
    const title =
      problemOf(recording.error)._tag === "Offline"
        ? m.player_offline_title()
        : m.player_not_found_title();
    return (
      <Dialog open={open} onOpenChange={onOpenChange} label={title} size="sm">
        <ErrorState
          title={title}
          actions={<Button onClick={() => onOpenChange(false)}>{m.action_close()}</Button>}
        />
      </Dialog>
    );
  }
  // The header names the recording's day in the household's calendar: wait for both.
  if (!entry || timeZone === undefined) return null;

  const span = recordedSpan(entry);
  const channel = channels.data?.find((candidate) => candidate.id === entry.channelId);
  const live = entry.state === "recording";
  const position = resumeMillis(entry);
  const input = {
    windowStart: span.start,
    windowEnd: span.end,
    live,
    now,
    ...(position === undefined ? {} : { resumeAt: span.start + position }),
  };
  // The recording window everywhere (17:55), as the timeline and "Watch from start" say.
  const started = Math.max(0, now - span.start);
  const pick = (option: ChoiceOption) => {
    const search =
      option.kind === "live"
        ? { at: "live" as const }
        : option.kind === "start"
          ? { at: "start" as const }
          : { at: "pos" as const, t: option.at };
    controls.leaveTo({ to: "/watch/rec/$id", params: { id: entry.id }, search });
  };

  return (
    <WatchChoice
      open={open}
      onOpenChange={onOpenChange}
      title={entry.title}
      subtitle={
        live
          ? m.choice_started_ago({ ago: formatDuration(started) })
          : slotLine(channel?.name, epochMs(entry.start), epochMs(entry.end), { now, timeZone })
      }
      artwork={recordingSubject(entry, channel)}
      input={input}
      timeline={recordingTimeline(entry, now, position)}
      onPick={pick}
    />
  );
}

/** The element that has focus now, unless that is nothing in particular. */
const focused = (): HTMLElement | null => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
};

/**
 * Returns focus to the control that opened an overlay once the URL closes it. The overlay opens
 * by URL and its dialog mounts already open (after its data loads), so the dialog never sees
 * the focus it would hand back: the opener is read while rendering the opening, before the
 * dialog takes focus, and focused again once the dialog let go (focus on nothing, or still in
 * the closing dialog). An opener that left the page (a pick navigated away) is left alone.
 */
function useReturnFocus(open: boolean): void {
  const [state, setState] = useState(() => ({ open, opener: open ? focused() : null }));
  if (state.open !== open) setState({ open, opener: open ? focused() : state.opener });
  const { opener } = state;
  useEffect(() => {
    if (open || opener === null) return;
    const restore = () => {
      const active = document.activeElement;
      const lost =
        active === null || active === document.body || active.closest("[role='dialog']") !== null;
      if (opener.isConnected && lost) opener.focus({ preventScroll: true });
    };
    // After the dialog's own close handling of this frame.
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [open, opener]);
}
