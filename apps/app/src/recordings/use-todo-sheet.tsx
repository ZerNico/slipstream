import type { RecordingId } from "@slipstream/domain";
import { useState } from "react";
import { useTodo } from "../data/hooks.ts";
import { RecordingSheet } from "./RecordingSheet.tsx";

/**
 * The open recording sheet of a screen with a "Needs attention" row, read from the live list so
 * Protect shows its new state and a deleted recording closes it.
 */
export const useTodoSheet = (now: number) => {
  const { items, entries, names } = useTodo(now);
  const [open, setOpen] = useState<RecordingId | undefined>(undefined);
  const opened = entries.find((entry) => entry.id === open);
  return {
    items,
    open: setOpen,
    sheet:
      opened === undefined ? null : (
        <RecordingSheet
          entry={opened}
          entries={entries}
          channelName={names.get(opened.channelId) ?? ""}
          onClose={() => setOpen(undefined)}
        />
      ),
  };
};
