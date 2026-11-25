import { useVirtualizer } from "@tanstack/react-virtual";
import { type Channel, type ChannelId, channelMark } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Checkbox } from "~/ui/primitives/checkbox.tsx";
import { Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";
import { ChannelMenu, FavouriteButton } from "./actions.tsx";
import { useLineupActions } from "./actions-context.ts";
import { channelLine, type LineupStreams } from "./model.ts";
import { NumberField } from "./number-field.tsx";

/** One row's height in px; rows, skeleton rows and the windowing share it. */
const ROW_HEIGHT = 56;

/** Room under the last row, so the floating bulk bar never covers it. */
const BAR_ROOM = 72;

/** One channel of the lineup: select, number, logo, name and its streams, favourite, menu. */
function LineupRow({
  channel,
  lineup,
  streams,
  open,
  selected,
  loading,
}: {
  channel: Channel;
  lineup: readonly Channel[];
  streams: LineupStreams;
  open: boolean;
  selected: boolean;
  loading: boolean;
}) {
  const actions = useLineupActions();
  const range = useRef(false);
  return (
    <div
      className={cn(
        "group flex h-full items-center gap-1.5 pr-2 pl-3",
        open ? "bg-hover shadow-[inset_2px_0_0_var(--brand)]" : "fine:hover:bg-hover",
        selected && "bg-selected",
      )}
    >
      <span
        className="contents"
        onClickCapture={(event) => {
          range.current = event.shiftKey;
        }}
      >
        <Checkbox
          checked={selected}
          disabled={loading}
          aria-label={m.lineup_select_named({ name: channel.name })}
          onCheckedChange={() => actions.select(channel.id, range.current)}
        />
      </span>
      <NumberField
        channel={channel}
        lineup={lineup}
        onSave={(number) => actions.setNumber(channel.id, number)}
      />
      <button
        type="button"
        data-channel={channel.id}
        aria-current={open || undefined}
        disabled={loading}
        className="flex h-full min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]"
        onClick={() => actions.open(channel.id)}
      >
        <ChannelLogo
          mark={channelMark(channel.name)}
          size="sm"
          {...(channel.logoUrl ? { logoUrl: channel.logoUrl } : {})}
        />
        <span className="grid min-w-0">
          <span className={cn("truncate font-semibold", channel.hidden && "text-fg-3")}>
            <Sk>{channel.name}</Sk>
          </span>
          <span className="truncate text-meta text-fg-3">
            <Sk>{channelLine(streams.byChannel.get(channel.id))}</Sk>
          </span>
        </span>
      </button>
      <span className="sk-hide flex items-center">
        <FavouriteButton channel={channel} />
        <ChannelMenu channel={channel} />
      </span>
    </div>
  );
}

/**
 * The lineup, windowed: only the rows near the visible part are in the page, so 600 channels
 * scroll like 20. ↑ and ↓ open the next or previous channel; the detail follows.
 */
export function LineupList({
  channels,
  lineup,
  streams,
  openId,
  selected,
  loading,
  label,
  onKey,
}: {
  channels: readonly Channel[];
  lineup: readonly Channel[];
  streams: LineupStreams;
  openId: ChannelId | undefined;
  selected: ReadonlySet<ChannelId>;
  loading: boolean;
  label: string;
  onKey: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  // TanStack Virtual hands back one mutable object; the compiler must not cache what it draws.
  "use no memo";
  const scroller = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line react/incompatible-library
  const virtual = useVirtualizer({
    count: channels.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    paddingEnd: BAR_ROOM,
    getItemKey: (index) => channels[index]?.id ?? index,
  });
  const openIndex = openId === undefined ? -1 : channels.findIndex((c) => c.id === openId);

  // The open channel stays in view (moving with ↑ and ↓, or opened elsewhere).
  useEffect(() => {
    if (openIndex >= 0) virtual.scrollToIndex(openIndex, { align: "auto" });
  }, [openIndex, virtual]);

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      onKeyDown={onKey}
    >
      <div
        role="list"
        aria-label={label}
        className="relative w-full"
        style={{ height: virtual.getTotalSize() }}
      >
        {virtual.getVirtualItems().map((item) => {
          const channel = channels[item.index];
          if (channel === undefined) return null;
          return (
            <div
              key={item.key}
              role="listitem"
              className="absolute inset-x-0 top-0 border-b border-line-faint"
              style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <LineupRow
                channel={channel}
                lineup={lineup}
                streams={streams}
                open={channel.id === openId}
                selected={selected.has(channel.id)}
                loading={loading}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
