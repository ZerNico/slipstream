import type { ChannelId, ProgrammeId } from "@slipstream/domain";

/** "Remind me instead": a programme to announce when it starts. Times are epoch ms. */
export interface Reminder {
  readonly programmeId: ProgrammeId;
  readonly channelId: ChannelId;
  readonly title: string;
  readonly start: number;
}

/** How long a reminder notice stays up once its programme has started. */
export const NOTICE_MS = 20_000;

/** Adds a reminder, once per programme, kept in start order. */
export const addReminder = (
  reminders: readonly Reminder[],
  reminder: Reminder,
): readonly Reminder[] =>
  [
    ...reminders.filter((existing) => existing.programmeId !== reminder.programmeId),
    reminder,
  ].toSorted((a, b) => a.start - b.start);

/**
 * Splits reminders at `now`: the ones to announce (started less than {@link NOTICE_MS} ago),
 * and the ones still waiting. Reminders older than the notice window are dropped.
 */
export const dueReminders = (
  reminders: readonly Reminder[],
  now: number,
): { readonly due: readonly Reminder[]; readonly waiting: readonly Reminder[] } => ({
  due: reminders.filter((reminder) => reminder.start <= now && now - reminder.start < NOTICE_MS),
  waiting: reminders.filter((reminder) => reminder.start > now),
});
