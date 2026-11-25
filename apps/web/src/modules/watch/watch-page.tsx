import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { DateTime } from "effect";
import {
  type ChannelId,
  epochMs,
  isPlayable,
  playTargetFor,
  type RecordingId,
} from "@slipstream/domain";
import { problemOf } from "~/api/errors.ts";
import { useHouseholdTimeZone, useQueries } from "~/api/hooks.ts";
import { formatTimeRange } from "~/i18n/formats.ts";
import { m, pathLabels } from "@slipstream/i18n";
import { gapsOf, itemName, missingMillis, recordedSpan } from "~/modules/library/library.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { useNow } from "~/ui/use-now.ts";
import { type PlayerProps, Player } from "./player.tsx";
import { type RecordAt, useRecordingActions, useRecordNow } from "./use-record-now.ts";
import { programmeSubject, recordingSubject } from "~/ui/artwork/subjects.ts";
import {
  bandsIn,
  channelItems,
  type RecordingSearch,
  recordingStart,
  siblingItems,
  slotLine,
  upNextItems,
} from "./watch-data.ts";

/** The player before its data arrives: titles as skeletons, nothing to play yet. */
const waiting = (back: "guide" | "recordings"): PlayerProps => ({
  source: undefined,
  start: { kind: "start" },
  title: m.player_loading(),
  subtitle: m.player_loading(),
  badge: undefined,
  subject: { mode: "running", window: undefined },
  poster: { title: "" },
  back,
  next: { label: m.player_tab_next(), items: [] },
  channels: [],
  allChannels: [],
  channelName: "",
  loading: true,
});

/**
 * The player for a recording (`/watch/rec/$id`): a running recording on the wall clock with
 * its live edge, a finished one as a position of its length. Details offers Extend and Stop
 * while it records; the panel lists the other sessions of its group.
 */
export function RecordingPlayerPage({ id, search }: { id: RecordingId; search: RecordingSearch }) {
  const queries = useQueries();
  const overlay = useOverlay();
  const now = useNow(30_000);
  const recording = useQuery(queries.recording(id));
  const channels = useQuery(queries.channels());
  const all = useQuery(queries.recordings());
  const nowNext = useQuery(queries.nowNext());
  const rules = useQuery(queries.rules());
  const timeZone = useHouseholdTimeZone();
  const entry = recording.data;
  const span = entry ? recordedSpan(entry) : { start: 0, end: 0 };
  const guide = useQuery({
    ...queries.guideWindow(span.start, span.end, entry ? [entry.channelId] : []),
    enabled: entry !== undefined,
  });
  const actions = useRecordingActions();
  const recordNow = useRecordNow({
    channelId: entry?.channelId,
    programmes: [],
    recordings: [],
    playing: entry,
  });

  if (recording.isError) {
    const offline = problemOf(recording.error)._tag === "Offline";
    return (
      <Player
        {...waiting("recordings")}
        problem={offline ? "offline" : "notFound"}
        loading={false}
      />
    );
  }
  // The subtitle names the day in the household's calendar: a skeleton until the zone is known.
  if (!entry || timeZone === undefined) return <Player {...waiting("recordings")} />;

  const channelList = channels.data ?? [];
  const channel = channelList.find((candidate) => candidate.id === entry.channelId);
  const running = entry.state === "recording";
  const playable = isPlayable(entry);
  const openProgramme = (programmeId: string) =>
    overlay.open({ kind: "sheet", name: "prog", arg: programmeId });
  // The first tab: the recording's siblings, else what the channel shows next while it records.
  const siblings = siblingItems(entry, all.data ?? [], channelList, openProgramme);
  const next = {
    label: m.player_tab_next(),
    items:
      siblings.length > 0 || !running
        ? siblings
        : upNextItems(guide.data ?? [], channel, now, openProgramme),
  };
  const artwork = recordingSubject(entry, channel);
  const rule = rules.data?.find((candidate) => candidate.id === entry.ruleId)?.name;
  const until = new Date(span.end);
  const props: PlayerProps = {
    source: playable ? { _tag: "Recording", recordingId: entry.id } : undefined,
    start: recordingStart(entry, search, running),
    title: entry.title,
    subtitle: slotLine(channel?.name, epochMs(entry.start), epochMs(entry.end), { now, timeZone }),
    badge: running ? "recording" : entry.state === "incomplete" ? "incomplete" : undefined,
    subject: {
      mode: running ? "running" : "finished",
      window: span,
      programmeStart: epochMs(entry.start),
      marks: [epochMs(entry.start), epochMs(entry.end)],
      bands: bandsIn(guide.data ?? [], entry.channelId, span.start, span.end),
      gaps: gapsOf(entry, now),
    },
    poster: artwork,
    back: "recordings",
    next,
    channels: channelItems(channelList, nowNext.data ?? [], entry.channelId, now),
    allChannels: channelList,
    channelName: channel?.name ?? entry.title,
    recording: {
      entry,
      shortTitle: itemName(entry, pathLabels()),
      artwork,
      ...(running
        ? {
            running: {
              until:
                rule === undefined
                  ? m.player_recording_extended({ end: until })
                  : m.player_recording_series({ end: until, name: rule }),
              busy: actions.busy,
              // One Extend, by the rule every client shares: a step more after the end.
              onExtend: () => actions.extend(entry),
              onStop: () => actions.stop(entry),
            },
          }
        : {}),
    },
    ...(playable ? {} : { problem: "nothing" as const }),
    ...(entry.state === "incomplete"
      ? { gapMinutes: Math.max(1, Math.round(missingMillis(entry, now) / 60_000)) }
      : {}),
    recordNow,
  };
  return <Player {...props} />;
}

/**
 * How far back the live bar shows earlier programmes: the server's pause buffer (its DVR window,
 * `RecorderTuning.dvrWindowMs`, 4 h by default). The API doesn't say the configured value, so
 * the bar assumes the default; the server still refuses what its buffer no longer holds.
 */
const PAUSE_BUFFER_MS = 4 * 60 * 60_000;

/** How far ahead "Up next" looks. */
const UP_NEXT_MS = 6 * 60 * 60_000;

/**
 * The player for a live channel (`/watch/live/$channel`). A channel that is being recorded
 * plays from that recording at live instead, so it can be rewound to where the recording began.
 */
export function LivePlayerPage({ channelId }: { channelId: ChannelId }) {
  const queries = useQueries();
  const overlay = useOverlay();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const channels = useQuery(queries.channels());
  const nowNext = useQuery(queries.nowNext());
  const recordings = useQuery(queries.recordings());
  // The programmes the pause buffer may still hold (bands to the left of this one) and the ones
  // coming up ("Up next"), on the five minutes so the key holds still.
  const from = Math.floor(now / 300_000) * 300_000;
  // The last answer stays while the next five minutes' window loads, so the bands and Up next
  // never blink empty; another channel's programmes never stand in for this one's.
  const guide = useQuery({
    ...queries.guideWindow(from - PAUSE_BUFFER_MS, from + UP_NEXT_MS, [channelId]),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.at(-1) === channelId ? previous : undefined,
  });

  // What a pick of the channel plays, by the rule every client shares (`playTargetFor`): a
  // recording running on it, from its live edge, else the channel live.
  const target =
    recordings.data === undefined
      ? undefined
      : playTargetFor({ channelId, recordings: recordings.data, now });
  const recordingNow = target?._tag === "Recording" ? target.recordingId : undefined;
  // Record pressed here: the recording plays on from where the playhead was, not from live.
  const pressedAt = useRef<RecordAt | undefined>(undefined);
  useEffect(() => {
    if (recordingNow === undefined) return;
    const at = pressedAt.current;
    void navigate({
      to: "/watch/rec/$id",
      params: { id: recordingNow },
      search:
        at === undefined || at.atLive ? { at: "live" } : { at: "pos", t: Math.round(at.atMs) },
      replace: true,
    });
  }, [recordingNow, navigate]);
  const recordNow = useRecordNow({
    channelId,
    programmes: guide.data ?? [],
    recordings: recordings.data ?? [],
    onPressed: (at) => {
      pressedAt.current = at;
    },
  });

  if (channels.isError) {
    const offline = problemOf(channels.error)._tag === "Offline";
    return (
      <Player {...waiting("guide")} problem={offline ? "offline" : "notFound"} loading={false} />
    );
  }
  if (channels.isPending || recordings.isPending || recordingNow !== undefined) {
    return <Player {...waiting("guide")} />;
  }
  const channelList = channels.data;
  const channel = channelList.find((candidate) => candidate.id === channelId);
  if (!channel) return <Player {...waiting("guide")} problem="notFound" loading={false} />;

  const on = nowNext.data?.find((entry) => entry.channelId === channelId)?.now;
  const slot = on ? { start: epochMs(on.start), end: epochMs(on.end) } : undefined;
  const openProgramme = (programmeId: string) =>
    overlay.open({ kind: "sheet", name: "prog", arg: programmeId });
  const props: PlayerProps = {
    source: { _tag: "Live", channelId },
    start: { kind: "live" },
    title: on?.title ?? channel.name,
    subtitle: slot ? `${channel.name} · ${formatTimeRange(slot.start, slot.end)}` : channel.name,
    badge: "live",
    subject: {
      mode: "running",
      window: slot,
      ...(slot
        ? {
            marks: [slot.start, slot.end],
            // Every programme the guide knows around now: the bar shows the ones the buffer
            // reaches back into, so earlier programmes can be watched from where they start.
            bands: bandsIn(guide.data ?? [], channelId, from - PAUSE_BUFFER_MS, slot.end),
          }
        : {}),
    },
    poster: on ? programmeSubject(on, channel) : { title: channel.name },
    back: "guide",
    next: {
      label: m.player_tab_next(),
      items: upNextItems(guide.data ?? [], channel, now, openProgramme),
    },
    channels: channelItems(channelList, nowNext.data ?? [], channelId, now),
    allChannels: channelList,
    channelName: channel.name,
    recordNow,
  };
  return <Player {...props} />;
}

/**
 * The player for a stretch of a channel out of the pause buffer (`/watch/range/$channel`): an
 * ended programme nobody recorded, from its start (SPEC §7.6). It plays as a finished thing,
 * 0:00 to its length. A range the buffer no longer holds is the server's `RangeNotCaptured`,
 * which the player says itself; `range` undefined (a broken link) is "not available".
 */
export function RangePlayerPage({
  channelId,
  range,
}: {
  channelId: ChannelId;
  range: { readonly start: number; readonly end: number } | undefined;
}) {
  const queries = useQueries();
  const overlay = useOverlay();
  const now = useNow(30_000);
  const channels = useQuery(queries.channels());
  const nowNext = useQuery(queries.nowNext());
  const timeZone = useHouseholdTimeZone();
  const span = range ?? { start: 0, end: 0 };
  // The range's own programme for the title, the bands, and what the channel shows next.
  const guide = useQuery({
    ...queries.guideWindow(span.start, span.end, [channelId]),
    enabled: range !== undefined,
  });
  const upcoming = useQuery(
    queries.guideWindow(Math.floor(now / 300_000) * 300_000, now + UP_NEXT_MS, [channelId]),
  );

  if (range === undefined) {
    return <Player {...waiting("guide")} problem="notFound" loading={false} />;
  }
  if (channels.isError) {
    const offline = problemOf(channels.error)._tag === "Offline";
    return (
      <Player {...waiting("guide")} problem={offline ? "offline" : "notFound"} loading={false} />
    );
  }
  // The title is the programme's: a skeleton until the guide answers (or failed: the channel).
  if (channels.isPending || guide.isPending || timeZone === undefined) {
    return <Player {...waiting("guide")} />;
  }
  const channelList = channels.data;
  const channel = channelList.find((candidate) => candidate.id === channelId);
  if (!channel) return <Player {...waiting("guide")} problem="notFound" loading={false} />;

  const programmes = guide.data ?? [];
  const programme =
    programmes.find(
      (candidate) => candidate.channelId === channelId && epochMs(candidate.start) === range.start,
    ) ?? programmes.find((candidate) => candidate.channelId === channelId);
  const openProgramme = (programmeId: string) =>
    overlay.open({ kind: "sheet", name: "prog", arg: programmeId });
  const props: PlayerProps = {
    source: {
      _tag: "Range",
      channelId,
      range: { start: DateTime.makeUnsafe(range.start), end: DateTime.makeUnsafe(range.end) },
    },
    start: { kind: "start" },
    title: programme?.title ?? channel.name,
    subtitle: slotLine(channel.name, range.start, range.end, { now, timeZone }),
    badge: undefined,
    subject: {
      mode: "finished",
      window: range,
      programmeStart: range.start,
      marks: [range.start, range.end],
      bands: bandsIn(programmes, channelId, range.start, range.end),
    },
    poster: programme ? programmeSubject(programme, channel) : { title: channel.name },
    back: "guide",
    next: {
      label: m.player_tab_next(),
      items: upNextItems(upcoming.data ?? [], channel, now, openProgramme),
    },
    channels: channelItems(channelList, nowNext.data ?? [], channelId, now),
    allChannels: channelList,
    channelName: channel.name,
  };
  return <Player {...props} />;
}
