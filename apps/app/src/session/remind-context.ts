import { createContext, useContext } from "react";
import type { Reminder } from "./reminders.ts";

/** Adds a reminder; `ReminderProvider` fills it. */
export const RemindersContext = createContext<((reminder: Reminder) => void) | undefined>(
  undefined,
);

/** Adds a "remind me" for a programme; only valid below `ReminderProvider`. */
export const useRemind = (): ((reminder: Reminder) => void) => {
  const remind = useContext(RemindersContext);
  if (remind === undefined) throw new Error("useRemind must be used inside ReminderProvider");
  return remind;
};
