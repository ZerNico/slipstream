import { describe, expect, it } from "vitest";
import { addReminder, dueReminders, NOTICE_MS, type Reminder } from "./reminders.ts";

const reminder = (id: string, start: number): Reminder => ({
  programmeId: id as Reminder["programmeId"],
  channelId: "c" as Reminder["channelId"],
  title: id,
  start,
});

describe("reminders", () => {
  it("keeps one reminder per programme in start order", () => {
    const list = addReminder(
      addReminder(addReminder([], reminder("b", 20)), reminder("a", 10)),
      reminder("b", 30),
    );
    expect(list.map((item) => [item.programmeId, item.start])).toEqual([
      ["a", 10],
      ["b", 30],
    ]);
  });

  it("announces started programmes for a while, then drops them", () => {
    const list = [reminder("old", 0), reminder("now", 50_000), reminder("later", 90_000)];
    const { due, waiting } = dueReminders(list, 50_000 + NOTICE_MS - 1);
    expect(due.map((item) => item.programmeId)).toEqual(["now"]);
    expect(waiting.map((item) => item.programmeId)).toEqual(["later"]);
  });
});
