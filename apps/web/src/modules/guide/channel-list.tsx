import { Link } from "@tanstack/react-router";
import {
  type Channel,
  channelMark,
  displayChannelName,
  epochMs,
  type GuideEntry,
  type ProgrammeMark,
} from "@slipstream/domain";
import { formatClock, formatTimeRange } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Icon } from "~/ui/icon.tsx";
import { PlayIcon, RecordIcon } from "~/ui/icons.ts";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Sk } from "~/ui/skeleton.tsx";
import { useIsLoading } from "~/ui/skeleton-state.ts";
import { cn } from "~/ui/utils.ts";
import { cellLabel } from "./labels.ts";
import { type GuideCategory, inCategory, nextAfter, programmeAt } from "./model.ts";
import { MarkDot } from "./timeline-grid.tsx";

/** One channel in the Channels view: what is on at the chosen time and what comes next. */
export interface ChannelSlotRow {
  readonly channel: Channel;
  readonly row: readonly GuideEntry[];
}

/**
 * The Channels view (SPEC §8.2, the phone default): per channel what is on at the chosen time,
 * "until 19:57 · 75 min left" with progress in the Now slot, a time range in later slots, the
 * next programme, an outlined Record button for what isn't recorded yet and Play while it airs.
 * Record and Play sit right after what they act on, before the next programme, so they never
 * read as belonging to it. Channels without guide data say so and offer Watch live.
 */
export function ChannelList({
  rows,
  at,
  isNow,
  now,
  marks,
  category,
  onOpen,
  onWatch,
}: {
  rows: readonly ChannelSlotRow[];
  /** The chosen moment. */
  at: number;
  /** The Now slot: progress and "min left" instead of a range. */
  isNow: boolean;
  now: number;
  marks: ReadonlyMap<string, ProgrammeMark>;
  category: GuideCategory;
  onOpen: (programme: GuideEntry) => void;
  /** Opens the watch choice of a recording that is running. */
  onWatch: (recording: string) => void;
}) {
  return (
    <div
      className="grid overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-line ring-inset"
      role="list"
      aria-label={isNow ? m.guide_on_now() : m.guide_on_at({ time: new Date(at) })}
    >
      {rows.map(({ channel, row }) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          current={programmeAt(row, at)}
          row={row}
          at={at}
          isNow={isNow}
          now={now}
          marks={marks}
          category={category}
          onOpen={onOpen}
          onWatch={onWatch}
        />
      ))}
    </div>
  );
}

const rowGrid =
  "grid min-h-[76px] grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-line p-3 last:border-b-0 md:grid-cols-[168px_minmax(0,1fr)_auto_minmax(0,.8fr)] md:items-center md:gap-4 md:px-4 lg:grid-cols-[196px_minmax(0,1.4fr)_auto_minmax(0,1fr)]";

const slotButton =
  "-mx-2 -my-1.5 grid min-w-0 content-center gap-1 rounded-[10px] px-2 py-1.5 text-left transition-colors duration-(--t-fast) hover:bg-hover coarse:min-h-11";

function ChannelRow({
  channel,
  current,
  row,
  at,
  isNow,
  now,
  marks,
  category,
  onOpen,
  onWatch,
}: {
  channel: Channel;
  current: GuideEntry | undefined;
  row: readonly GuideEntry[];
  at: number;
  isNow: boolean;
  now: number;
  marks: ReadonlyMap<string, ProgrammeMark>;
  category: GuideCategory;
  onOpen: (programme: GuideEntry) => void;
  onWatch: (recording: string) => void;
}) {
  const loading = useIsLoading();
  const name = displayChannelName(channel.name);
  const next = current ? nextAfter(row, current) : undefined;
  const mark = current ? marks.get(current.id) : undefined;
  const nextMark = next ? marks.get(next.id) : undefined;
  const airing =
    current !== undefined && epochMs(current.start) <= now && epochMs(current.end) > now;
  const noData = current === undefined && !loading;

  const who = (
    <Link
      to="/watch/live/$channel"
      params={{ channel: channel.id }}
      aria-label={m.guide_watch_channel_live({ channel: channel.name })}
      className="row-span-2 flex min-w-0 flex-col items-center gap-1 text-[14px] font-semibold coarse:min-h-11 md:row-span-1 md:flex-row md:gap-3"
    >
      <Sk className="hidden w-4 flex-none text-[12px] text-fg-3 tabular-nums md:block" chars={1}>
        {channel.number === undefined ? "" : String(channel.number)}
      </Sk>
      <ChannelLogo
        mark={channelMark(channel.name)}
        size="lg"
        {...(channel.logoUrl ? { logoUrl: channel.logoUrl } : {})}
      />
      <Sk className="hidden min-w-0 flex-1 truncate md:block" chars={9}>
        {name}
      </Sk>
    </Link>
  );

  if (noData) {
    return (
      <div className={rowGrid} role="listitem">
        {who}
        <div className="grid min-w-0 gap-1 text-fg-3">
          <span className="truncate text-[14.5px] font-semibold">{m.guide_no_data()}</span>
        </div>
        <div className="col-start-3 row-start-1 flex min-w-[84px] justify-end md:justify-start">
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/watch/live/$channel" params={{ channel: channel.id }} />}
          >
            {m.player_watch_live()}
          </Button>
        </div>
      </div>
    );
  }

  const progress =
    current && isNow
      ? (at - epochMs(current.start)) / (epochMs(current.end) - epochMs(current.start))
      : 0;
  const left = current ? Math.max(0, Math.round((epochMs(current.end) - at) / 60_000)) : 0;
  const recordingId = mark?.state === "recording" ? mark.recordingId : undefined;
  // Recorded or scheduled already: no Record. An episode the viewer merely has keeps it, as its
  // sheet still offers Record (anyway).
  const scheduled = mark !== undefined && mark.state !== "repeat";
  const dim = current !== undefined && !inCategory(current, category);

  return (
    <div
      className={cn(rowGrid, "transition-opacity duration-(--t-fast)", dim && "opacity-35")}
      role="listitem"
    >
      {who}
      <button
        type="button"
        className={slotButton}
        disabled={current === undefined}
        aria-label={current ? cellLabel(name, current, mark) : undefined}
        onClick={() => {
          if (current) onOpen(current);
        }}
      >
        {/* The marker sits inside the title's slot, so the slot keeps its box when it arrives. */}
        <Sk className="block truncate text-[14.5px] font-semibold" chars={18}>
          {current ? (
            <>
              {mark ? (
                <MarkDot state={mark.state} className="mr-2 inline-block align-middle" />
              ) : null}
              {current.title}
            </>
          ) : undefined}
        </Sk>
        <Sk className="block truncate text-[12.5px] text-fg-3 tabular-nums" chars={22}>
          {current
            ? isNow
              ? m.guide_until_left({ end: new Date(epochMs(current.end)), leftMinutes: left })
              : current.subtitle
                ? `${formatTimeRange(epochMs(current.start), epochMs(current.end))} · ${current.subtitle}`
                : formatTimeRange(epochMs(current.start), epochMs(current.end))
            : undefined}
        </Sk>
        <span
          className={cn("h-[3px] overflow-hidden rounded-[2px] bg-line-2", !isNow && "invisible")}
          aria-hidden="true"
        >
          {/* Neutral: red is for what records, and every channel airs something. */}
          <i className="block h-full bg-fg-3" style={{ width: `${progress * 100}%` }} />
        </span>
      </button>
      <button
        type="button"
        className={cn(slotButton, "col-start-2 -mt-0.5 md:col-start-4 md:row-start-1 md:mt-[-6px]")}
        disabled={next === undefined}
        aria-label={next ? cellLabel(name, next, nextMark) : undefined}
        onClick={() => {
          if (next) onOpen(next);
        }}
      >
        <Sk className="block truncate text-[13px] font-[550] text-fg-2 md:text-[14px]" chars={14}>
          {next ? (
            <>
              <b className="mr-2 font-semibold text-fg-3 tabular-nums md:hidden">
                {formatClock(epochMs(next.start))}
              </b>
              {nextMark ? (
                <MarkDot state={nextMark.state} className="mr-2 inline-block align-middle" />
              ) : null}
              {next.title}
            </>
          ) : undefined}
        </Sk>
        <Sk className="hidden truncate text-[12.5px] text-fg-3 tabular-nums md:block" chars={18}>
          {next
            ? m.guide_next_range({
                start: new Date(epochMs(next.start)),
                end: new Date(epochMs(next.end)),
              })
            : undefined}
        </Sk>
      </button>
      <div className="col-start-3 row-start-1 flex min-w-[84px] justify-end gap-1 md:justify-start">
        <span
          className={cn(
            // Grey at rest, red only under the pointer: a column of red reads as "all recording".
            "[&_svg]:text-fg-3 [&_button:hover_svg]:text-live-fg [&_button:focus-visible_svg]:text-live-fg",
            (scheduled || current === undefined || loading) && "invisible",
          )}
        >
          <IconButton
            variant="outline"
            label={m.guide_record_title({ title: current?.title ?? "" })}
            onClick={() => {
              if (current) onOpen(current);
            }}
          >
            <Icon icon={RecordIcon} size={16} />
          </IconButton>
        </span>
        <span className={cn(!(airing || recordingId) && "invisible")}>
          {recordingId ? (
            <IconButton
              label={m.guide_watch_title({ title: current?.title ?? "" })}
              aria-haspopup="dialog"
              onClick={() => onWatch(recordingId)}
            >
              <Icon icon={PlayIcon} />
            </IconButton>
          ) : (
            <IconButton
              label={m.guide_watch_channel_live({ channel: channel.name })}
              nativeButton={false}
              render={<Link to="/watch/live/$channel" params={{ channel: channel.id }} />}
            >
              <Icon icon={PlayIcon} />
            </IconButton>
          )}
        </span>
      </div>
    </div>
  );
}
