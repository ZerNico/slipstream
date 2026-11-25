/**
 * The words on Home's cards, one function per row, so the cards and the remembered layout
 * (`shape.ts`) say exactly the same thing.
 */
import type { RecordingEntry } from "@slipstream/api";
import { type Channel, epochMs } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { recordedSpan, resumeMillis } from "~/modules/library/library.ts";
import type { OnNowItem, ScheduledItem } from "./model.ts";
import { channelOf } from "./present.ts";
import type { CardText } from "./shape.ts";

const channelName = (channels: readonly Channel[], id: string) =>
  channelOf(channels, id)?.name ?? "";

/** A Continue watching card: "Sky Sport F1 · 29 min left". */
export const continueText = (entry: RecordingEntry, channels: readonly Channel[]): CardText => {
  const span = recordedSpan(entry);
  const left = Math.max(0, span.end - span.start - (resumeMillis(entry) ?? 0));
  return {
    title: entry.title,
    subtitle: m.home_card_left({
      channel: channelName(channels, entry.channelId),
      seconds: Math.round(left / 60_000) * 60,
    }),
    isNew: false,
    badges: entry.state === "incomplete",
    when: false,
    progress: true,
  };
};

/** An On now card: "Das Erste · 17:15–19:57". */
export const onNowText = (item: OnNowItem): CardText => ({
  title: item.programme.title,
  subtitle: m.home_card_slot({
    channel: item.channel.name,
    start: new Date(epochMs(item.programme.start)),
    end: new Date(epochMs(item.programme.end)),
  }),
  isNew: false,
  badges: true,
  when: false,
  progress: true,
});

/** A Scheduled recordings card: "ZDF · Rule: Terra X" or "arte · Recorded by hand". */
export const scheduledText = (
  item: ScheduledItem,
  channels: readonly Channel[],
  ruleName: string | undefined,
): CardText => {
  const channel = channelName(channels, item.entry.channelId);
  return {
    title: item.entry.title,
    subtitle:
      ruleName === undefined
        ? m.home_card_by_hand({ channel })
        : m.home_card_series({ channel, name: ruleName }),
    isNew: false,
    badges: item.conflict,
    when: true,
    progress: false,
  };
};

/** A New in your library card: "Sky Sport F1 · Thu 19 Nov", with the new dot. */
export const newText = (entry: RecordingEntry, channels: readonly Channel[]): CardText => ({
  title: entry.title,
  subtitle: m.home_card_day({
    channel: channelName(channels, entry.channelId),
    start: new Date(epochMs(entry.start)),
  }),
  isNew: true,
  badges: entry.state === "incomplete",
  when: false,
  progress: false,
});
