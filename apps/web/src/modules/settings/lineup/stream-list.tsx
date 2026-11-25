import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useQuery } from "@tanstack/react-query";
import { type Channel, moveItem, type SourceStreamId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useState } from "react";
import { Icon } from "~/ui/icon.tsx";
import { GripIcon, MoreIcon, SplitIcon, UnlinkIcon } from "~/ui/icons.ts";
import { IconButton } from "~/ui/primitives/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/ui/primitives/dropdown-menu.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { type LineupStream, type LineupStreams, orderedStreams, qualityTag } from "./model.ts";
import { useLineupQueries, useSetStreams, useSplitChannel } from "./queries.ts";

const notSaved = () => toast({ title: m.state_not_saved(), type: "error" });

/** One stream: its place in the order, source and name, quality, and its menu. */
function StreamRow({
  id,
  stream,
  index,
  only,
  onSplit,
  onRemove,
}: {
  id: SourceStreamId;
  stream: LineupStream | undefined;
  index: number;
  only: boolean;
  onSplit: () => void;
  onRemove: () => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled: only });
  const name = stream?.name ?? id;
  const quality = stream === undefined ? undefined : qualityTag(stream.quality);
  return (
    <li
      ref={ref}
      className={cn(
        "flex min-h-14 items-center gap-2 bg-surface py-2 pr-2 pl-1",
        isDragging && "relative z-1 shadow-pop",
      )}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={m.channel_move({ name })}
        disabled={only}
        className="grid size-9 flex-none cursor-grab touch-none place-items-center rounded-md text-fg-3 coarse:size-11 fine:hover:bg-hover disabled:invisible"
      >
        <Icon icon={GripIcon} size={16} />
      </button>
      <span className="w-4 flex-none text-right text-meta text-fg-3 tabular-nums">{index + 1}</span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-semibold">{stream?.sourceName ?? name}</span>
        <span className="truncate text-meta text-fg-2">{name}</span>
      </span>
      <span className="grid flex-none justify-items-end text-meta">
        <span className="text-fg-2">{quality ?? " "}</span>
        {stream?.gone === true ? (
          <span className="text-warn-fg">{m.lineup_stream_gone()}</span>
        ) : null}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton size="sm" tooltip={false} label={m.lineup_stream_menu({ name })}>
              <Icon icon={MoreIcon} size={16} />
            </IconButton>
          }
        />
        <DropdownMenuContent aria-label={m.lineup_stream_menu({ name })}>
          <DropdownMenuItem icon={<Icon icon={SplitIcon} />} disabled={only} onClick={onSplit}>
            {m.lineup_split()}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Icon icon={UnlinkIcon} />} onClick={onRemove}>
            {m.lineup_stream_remove()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * A channel's streams in fallback order: the first is tried first, the next when it fails.
 * Drag a row by its handle (or focus the handle and use Space and the arrow keys) to change
 * the order; a stream can become a channel of its own or leave the channel.
 */
export function StreamList({ channel, streams }: { channel: Channel; streams: LineupStreams }) {
  const queries = useLineupQueries();
  const links = useQuery(queries.streams(channel.id));
  const setStreams = useSetStreams();
  const split = useSplitChannel();
  // The order shown while saving, for the answer it was made from.
  const [kept, setKept] = useState<{ base: unknown; ids: readonly SourceStreamId[] }>();
  const ordered = orderedStreams(links.data ?? [], streams);
  const byId = new Map(ordered.map((entry) => [entry.id, entry]));
  const ids =
    kept !== undefined && kept.base === links.data ? kept.ids : ordered.map((entry) => entry.id);
  const shown = ids.flatMap((id) => byId.get(id) ?? []);
  const save = (next: readonly SourceStreamId[]) => {
    setKept({ base: links.data, ids: next });
    setStreams.mutate(
      { id: channel.id, streams: next },
      {
        onError: () => {
          setKept(undefined);
          notSaved();
        },
      },
    );
  };

  if (links.data !== undefined && shown.length === 0) {
    return <p className="panel px-4 py-3 text-meta text-fg-2">{m.lineup_streams_empty()}</p>;
  }
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source } = event.operation;
        if (!isSortable(source) || source.initialIndex === source.index) return;
        save(moveItem(ids, source.initialIndex, source.index));
      }}
    >
      <ol
        className="panel divide-y divide-line overflow-hidden"
        aria-label={m.lineup_streams()}
        aria-busy={links.isPending || undefined}
      >
        {links.data === undefined
          ? [0, 1].map((index) => <li key={index} className="h-14 bg-surface" />)
          : shown.map((entry, index) => (
              <StreamRow
                key={entry.id}
                id={entry.id}
                stream={entry.stream}
                index={index}
                only={shown.length === 1}
                onRemove={() => save(ids.filter((id) => id !== entry.id))}
                onSplit={() =>
                  split.mutate(
                    { id: channel.id, sourceStreamId: entry.id },
                    {
                      onSuccess: (created) =>
                        toast({ title: m.lineup_split_done({ name: created.name }) }),
                      onError: notSaved,
                    },
                  )
                }
              />
            ))}
      </ol>
    </DragDropProvider>
  );
}
