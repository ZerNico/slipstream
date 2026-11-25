import type { RecordingEntry } from "@slipstream/api";
import {
  type Channel,
  type ChannelId,
  epochMs,
  type Programme,
  visibleChannels,
} from "@slipstream/domain";
import { formatClock, formatDay, formatDuration, formatTimeRange } from "~/i18n/formats.ts";
import { dayPill, m, pathLabels } from "@slipstream/i18n";
import { itemName, recordedSpan, resumeMillis } from "~/modules/library/library.ts";
import type { Band } from "~/ui/timeline/geometry.ts";
import type { PanelItem } from "./panel.tsx";
import { startTarget } from "./player-model.ts";
import { programmeSubject, recordingSubject } from "~/ui/artwork/subjects.ts";
import type { StartAt } from "./use-hls-playback.ts";

/*
 * What the player pages make of the data: where playback starts, the timeline's bands, the
 * panel's lists. Pure, so the rules are tested without rendering.
 */

/** How the recording player was opened (`?at=` and `?t=`). */
export interface RecordingSearch {
  readonly at?: "resume" | "start" | "live" | "pos" | undefined;
  readonly t?: number | undefined;
}

/**
 * A band's name on the timeline: the programme without the series prefix and the event suffix,
 * "Qualifying" for "Live F1: Qualifying - GP Katar". Titles without either stay whole.
 */
export const bandTitle = (title: string): string => {
  const afterPrefix = title.includes(": ") ? title.slice(title.indexOf(": ") + 2) : title;
  const dash = afterPrefix.lastIndexOf(" - ");
  return dash > 0 ? afterPrefix.slice(0, dash) : afterPrefix;
};

/** Joins a short phrase with no-break spaces, so a line never breaks inside it. */
const keepTogether = (text: string): string => text.replaceAll(" ", " ");

/**
 * "Sky Sport F1 · Sun 22 · 18:00–19:30": the channel, the day as the guide's pills write it in
 * the household's calendar (SPEC decision 11) and the time span, apart as the programme sheet
 * sets them. A narrow header (the short-landscape dialog) wraps between the parts only, never
 * inside "Sun 22" or "6:00 – 7:30 PM".
 */
export const slotLine = (
  channel: string | undefined,
  start: number,
  end: number,
  clock: { readonly now: number; readonly timeZone: string },
): string =>
  [
    channel,
    keepTogether(dayPill(start, clock.now, clock.timeZone)),
    keepTogether(formatTimeRange(start, end)),
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Where a recording starts playing. `live` and `start` go to the live edge and the first
 * recorded second (the recording window, 17:55, the same as the choice dialog says); `pos`
 * takes `t`; `resume` (and no `at`) this profile's position, else the start.
 */
export const recordingStart = (
  entry: RecordingEntry,
  search: RecordingSearch,
  running: boolean,
): StartAt => {
  const span = recordedSpan(entry);
  const resume = resumeMillis(entry);
  switch (search.at) {
    case "live":
      return running ? { kind: "live" } : { kind: "start" };
    case "start":
      return { kind: "start" };
    case "pos": {
      if (search.t === undefined) return { kind: "start" };
      const target = startTarget(search.t);
      if (target.kind === "offset") return { kind: "offset", seconds: target.ms / 1000 };
      return running
        ? target
        : { kind: "offset", seconds: Math.max(0, target.at - span.start) / 1000 };
    }
    case "resume":
    case undefined:
      if (resume === undefined) return { kind: "start" };
      return running
        ? { kind: "clock", at: span.start + resume }
        : { kind: "offset", seconds: resume / 1000 };
  }
};

/** Same folder and collection: the other sessions of the event, the other episodes. */
const sameGroup = (a: RecordingEntry, b: RecordingEntry) =>
  a.group.source === b.group.source &&
  a.group.collectionId === b.group.collectionId &&
  JSON.stringify(a.group.folders) === JSON.stringify(b.group.folders);

/**
 * The panel's first tab for a recording: its siblings in the same group, scheduled ones drawn
 * quieter and opening their programme. Empty when the recording has no siblings.
 */
export const siblingItems = (
  entry: RecordingEntry,
  all: readonly RecordingEntry[],
  channels: readonly Channel[],
  openProgramme: (programmeId: string) => void,
): PanelItem[] => {
  const labels = pathLabels();
  const siblings = all
    .filter((other) => sameGroup(other, entry) && other.state !== "failed")
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
  if (siblings.length < 2) return [];
  const channel = (id: ChannelId) => channels.find((candidate) => candidate.id === id);
  return siblings.map((other): PanelItem => {
    const start = epochMs(other.start);
    const length = epochMs(other.end) - start;
    const scheduled = other.state === "scheduled";
    const watched =
      other.positionMillis > 0 && !other.watched
        ? Math.min(1, other.positionMillis / Math.max(1, length))
        : undefined;
    const programmeId = other.programmeId;
    return {
      key: other.id,
      title: itemName(other, labels),
      meta: `${formatDay(start)} ${formatClock(start)} · ${formatDuration(length)}`,
      subject: recordingSubject(other, channel(other.channelId)),
      ...(other.state === "recording" ? { badge: "rec" as const } : {}),
      ...(scheduled ? { badge: "sched" as const, ghost: true } : {}),
      ...(watched === undefined ? {} : { progress: { value: watched, tone: "brand" as const } }),
      ...(other.id === entry.id ? { current: true } : {}),
      ...(scheduled
        ? programmeId === undefined
          ? {}
          : { onSelect: () => openProgramme(programmeId) }
        : { link: { to: "/watch/rec/$id", params: { id: other.id }, search: {} } }),
    };
  });
};

/** What a channel shows next, for "Up next": up to five programmes from now. */
export const upNextItems = (
  programmes: readonly Programme[],
  channel: Channel | undefined,
  now: number,
  openProgramme: (programmeId: string) => void,
): PanelItem[] =>
  programmes
    .filter(
      (programme) =>
        epochMs(programme.start) >= now &&
        (channel === undefined || programme.channelId === channel.id),
    )
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start))
    .slice(0, 5)
    .map((programme) => ({
      key: programme.id,
      title: programme.title,
      meta: formatTimeRange(epochMs(programme.start), epochMs(programme.end)),
      subject: programmeSubject(programme, channel),
      onSelect: () => openProgramme(programme.id),
    }));

/** Every visible channel by number with what is on now and how far it is, for Channels. */
export const channelItems = (
  channels: readonly Channel[],
  nowNext: readonly { readonly channelId: ChannelId; readonly now?: Programme }[],
  current: ChannelId | undefined,
  now: number,
): PanelItem[] =>
  visibleChannels(channels).map((channel): PanelItem => {
    const on = nowNext.find((entry) => entry.channelId === channel.id)?.now;
    const slot = on ? { start: epochMs(on.start), end: epochMs(on.end) } : undefined;
    return {
      key: channel.id,
      title: on?.title ?? channel.name,
      meta: slot
        ? `${channel.name} · ${formatTimeRange(slot.start, slot.end)}`
        : `${channel.name} · ${m.guide_no_data()}`,
      subject: on ? programmeSubject(on, channel) : { title: channel.name },
      ...(slot
        ? {
            progress: {
              value: Math.min(
                1,
                Math.max(0, (now - slot.start) / Math.max(1, slot.end - slot.start)),
              ),
              tone: "live" as const,
            },
          }
        : {}),
      ...(channel.id === current ? { current: true } : {}),
      link: { to: "/watch/live/$channel", params: { channel: channel.id } },
    };
  });

/** The timeline's bands: the channel's programmes inside the window, named short. */
export const bandsIn = (
  programmes: readonly Programme[],
  channelId: ChannelId,
  start: number,
  end: number,
): Band[] =>
  programmes
    .filter(
      (programme) =>
        programme.channelId === channelId &&
        epochMs(programme.end) > start &&
        epochMs(programme.start) < end,
    )
    .toSorted((a, b) => epochMs(a.start) - epochMs(b.start))
    .map((programme) => ({
      start: epochMs(programme.start),
      end: epochMs(programme.end),
      title: bandTitle(programme.title),
    }));
