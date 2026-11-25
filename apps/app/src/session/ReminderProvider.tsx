import { m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { playerParams } from "../player/playback.ts";
import { NoticeFrame } from "../ui/ToastHost.tsx";
import { useNow } from "../ui/use-now.ts";
import { addReminder, dueReminders, type Reminder } from "./reminders.ts";
import { RemindersContext } from "./remind-context.ts";

/**
 * The notice for a programme that just started, in the toast's frame at the top; on a phone with
 * a way straight to it (on TV a notice never takes focus, see `NoticeFrame`).
 */
const Notice = ({ reminder }: { readonly reminder: Reminder }) => {
  const router = useRouter();
  return (
    <NoticeFrame
      edge="top"
      text={m.record_starting({ title: reminder.title })}
      action={{
        label: m.player_watch(),
        onPress: () =>
          router.push({
            pathname: "/player",
            params: playerParams({ _tag: "Live", channelId: reminder.channelId, from: "live" }),
          }),
      }}
    />
  );
};

/**
 * Keeps the "Remind me instead" list for this app session and shows a notice when a
 * programme starts. Reminders live in memory: a system notification needs expo-notifications,
 * which this version does not ship.
 */
export const ReminderProvider = ({ children }: { readonly children: ReactNode }) => {
  const [reminders, setReminders] = useState<readonly Reminder[]>([]);
  const now = useNow(5000);
  const announce = useMemo(() => dueReminders(reminders, now).due, [reminders, now]);

  const remind = useMemo(
    () => (reminder: Reminder) =>
      setReminders((current) => {
        // Drop reminders whose notice has already come and gone.
        const { due, waiting } = dueReminders(current, Date.now());
        return addReminder([...due, ...waiting], reminder);
      }),
    [],
  );
  const notice = announce[0];
  return (
    <RemindersContext value={remind}>
      {children}
      {notice === undefined ? null : <Notice reminder={notice} />}
    </RemindersContext>
  );
};
