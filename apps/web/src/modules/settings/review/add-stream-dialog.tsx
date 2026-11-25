import { useQuery } from "@tanstack/react-query";
import { addKind, type ChannelId, type FoundStream, type SourceId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useRef, useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { SearchField, Segmented } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useDebouncedValue } from "~/ui/use-debounced-value.ts";
import { useAddStream, useReviewQueries } from "./queries.ts";

/** One found stream: its name, source and group or channel, and Add, Move here or a note. */
function FoundRow({
  stream,
  channelId,
  busy,
  onAdd,
}: {
  stream: FoundStream;
  channelId: ChannelId;
  busy: boolean;
  onAdd: () => void;
}) {
  const kind = addKind(stream, channelId);
  const where =
    stream.channel === undefined || kind === "here"
      ? stream.group
      : m.stream_in_channel({ name: stream.channel.name });
  return (
    <li className="flex min-h-14 items-center gap-3 px-3 py-2">
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-semibold">{stream.name}</span>
        <span className="truncate text-meta text-fg-2">
          {[stream.sourceName, where].filter((part) => part !== undefined).join(" · ")}
        </span>
      </span>
      {kind === "here" ? (
        <span className="flex-none text-meta text-fg-3">{m.stream_on_this_channel()}</span>
      ) : kind === "move" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={m.stream_move_here_named({ name: stream.name })}
          onClick={onAdd}
        >
          {m.stream_move_here()}
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={busy}
          aria-label={m.stream_add_named({ name: stream.name })}
          onClick={onAdd}
        >
          {m.stream_add()}
        </Button>
      )}
    </li>
  );
}

/**
 * "Add stream to kabel eins": searches the streams of every source (or one), and adds the one
 * picked as the channel's last fallback. A stream on another channel says so and moves here.
 * Used from a channel's Streams and from "Choose stream…" for a channel with no stream left.
 */
export function AddStreamDialog({
  channel,
  open,
  onOpenChange,
  onAdded,
}: {
  channel: { readonly id: ChannelId; readonly name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: (stream: FoundStream) => void;
}) {
  const queries = useQueries();
  const review = useReviewQueries();
  const sources = useQuery(queries.sources());
  const add = useAddStream();
  const field = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState(channel.name);
  const [only, setOnly] = useState<SourceId | "all">("all");
  const term = useDebouncedValue(search.trim(), 250);
  const sourceList = (sources.data ?? []).map((source) => ({ id: source.id, name: source.name }));
  const found = useQuery({ ...review.findStreams(sourceList, term), enabled: open && term !== "" });
  const shown = (found.data ?? []).filter((stream) => only === "all" || stream.sourceId === only);
  const pick = (stream: FoundStream) =>
    add.mutate(
      { channelId: channel.id, streamId: stream.id, from: stream.channel?.id },
      {
        onSuccess: () => {
          toast({
            title: m.stream_added_named({ stream: stream.name, channel: channel.name }),
            type: "success",
          });
          onAdded?.(stream);
        },
        onError: () => toast({ title: m.state_not_saved(), type: "error" }),
      },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={m.stream_add_title({ name: channel.name })}
      showTitle
      size="sm"
      keyboardFocus={field}
      footer={
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {m.action_done()}
        </Button>
      }
    >
      <div className="grid gap-3 p-4">
        <SearchField
          ref={field}
          value={search}
          placeholder={m.stream_add_search()}
          aria-label={m.stream_add_search()}
          onChange={(event) => setSearch(event.target.value)}
        />
        {sourceList.length > 1 ? (
          <Segmented<SourceId | "all">
            label={m.stream_add_sources()}
            value={only}
            onChange={setOnly}
            className="max-w-full overflow-x-auto"
            segments={[
              { value: "all", label: m.stream_add_all_sources() },
              ...sourceList.map((source) => ({ value: source.id, label: source.name })),
            ]}
          />
        ) : null}
        {/* A fixed height: results come and go while typing, the dialog stays put. */}
        <div className="h-90 overflow-y-auto overscroll-contain">
          {term === "" ? (
            <p className="px-3 py-2 text-meta text-fg-2">{m.stream_type_to_search()}</p>
          ) : found.data !== undefined && shown.length === 0 ? (
            <p className="px-3 py-2 text-meta text-fg-2">{m.stream_none_match()}</p>
          ) : (
            <ul
              className="panel divide-y divide-line overflow-hidden"
              aria-label={m.stream_add_title({ name: channel.name })}
              aria-busy={found.isFetching || undefined}
            >
              {shown.map((stream) => (
                <FoundRow
                  key={stream.id}
                  stream={stream}
                  channelId={channel.id}
                  busy={add.isPending}
                  onAdd={() => pick(stream)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
