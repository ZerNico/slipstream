import { useQuery } from "@tanstack/react-query";
import {
  type ChannelId,
  channelMark,
  type GoneChannel,
  goneChannels,
  reviewSummary,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { formatList } from "~/i18n/formats.ts";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, HideIcon } from "~/ui/icons.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useUpdateChannels } from "../lineup/queries.ts";
import { AddStreamDialog } from "./add-stream-dialog.tsx";

/** What was done to a channel here: hidden, or a stream added from a source. */
type Done = { readonly kind: "hidden" } | { readonly kind: "added"; readonly source: string };

/**
 * One channel a playlist dropped streams of. With a fallback: a quiet tick and the source it
 * plays from. With nothing left (red): Choose stream… and Hide. Whatever is done here takes the
 * buttons' place at the same height.
 */
function GoneRow({
  entry,
  done,
  busy,
  onChoose,
  onHide,
}: {
  entry: GoneChannel;
  done: Done | undefined;
  busy: boolean;
  onChoose: () => void;
  onHide: () => void;
}) {
  const playsFrom = done?.kind === "added" ? done.source : entry.playsFrom;
  const broken = entry.noStream && done === undefined;
  return (
    <li className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <ChannelLogo mark={channelMark(entry.channel.name)} size="sm" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-semibold">{entry.channel.name}</span>
        {done?.kind === "hidden" ? (
          <span className="flex items-center gap-1.5 truncate text-meta text-fg-2">
            <Icon icon={HideIcon} size={14} />
            {m.review_hidden_named({ name: entry.channel.name })}
          </span>
        ) : broken ? (
          <span className="truncate text-meta text-live-fg">{m.review_no_stream_left()}</span>
        ) : (
          <span className="flex items-center gap-1.5 truncate text-meta text-fg-2">
            <Icon icon={CheckIcon} size={14} className="text-ok-fg" />
            {playsFrom === undefined ? " " : m.review_plays_from({ source: playsFrom })}
          </span>
        )}
      </span>
      {broken ? (
        <span className="flex flex-none items-center gap-1 max-sm:ml-auto">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onHide}
            aria-label={m.review_hide_named({ name: entry.channel.name })}
          >
            {m.lineup_hide()}
          </Button>
          <Button size="sm" disabled={busy} onClick={onChoose}>
            {m.review_choose_stream()}
          </Button>
        </span>
      ) : null}
    </li>
  );
}

/** The dialog's body, mounted while it is open: the channels as they were when it opened. */
function GoneBody({ entries, onDone }: { entries: readonly GoneChannel[]; onDone: () => void }) {
  const [shown] = useState(entries);
  const [done, setDone] = useState<ReadonlyMap<ChannelId, Done>>(new Map());
  const [choosing, setChoosing] = useState<GoneChannel["channel"]>();
  const hide = useUpdateChannels();
  const mark = (id: ChannelId, value: Done) =>
    setDone((before) => new Map([...before, [id, value]]));
  return (
    <>
      <div className="p-4 sm:p-5.5">
        <ul
          className="panel divide-y divide-line overflow-hidden"
          aria-label={m.review_gone_title()}
        >
          {shown.map((entry) => (
            <GoneRow
              key={entry.channel.id}
              entry={entry}
              done={done.get(entry.channel.id)}
              busy={hide.isPending}
              onChoose={() => setChoosing(entry.channel)}
              onHide={() =>
                hide.mutate(
                  { ids: [entry.channel.id], update: { hidden: true } },
                  {
                    onSuccess: () => mark(entry.channel.id, { kind: "hidden" }),
                    onError: () => toast({ title: m.state_not_saved(), type: "error" }),
                  },
                )
              }
            />
          ))}
        </ul>
      </div>
      <div className="sticky bottom-0 flex justify-end border-t border-line bg-surface px-4 py-3 sm:px-5.5">
        <Button onClick={onDone}>{m.action_done()}</Button>
      </div>
      {choosing === undefined ? null : (
        <AddStreamDialog
          channel={choosing}
          open
          onOpenChange={(open) => {
            if (!open) setChoosing(undefined);
          }}
          onAdded={(stream) => {
            mark(choosing.id, { kind: "added", source: stream.sourceName });
            setChoosing(undefined);
          }}
        />
      )}
    </>
  );
}

/**
 * `?dlg=gone-review`: channels whose streams a playlist dropped. Those that still have another
 * stream only say where they play from; those with nothing left get a new stream or are hidden.
 */
export function GoneReviewDialog() {
  const binding = useOverlayBinding("dlg", "gone-review");
  const overlay = useOverlay();
  const queries = useQueries();
  const review = useQuery({ ...queries.lineupReview(), enabled: binding.open });
  const data = review.data;
  const summary = data === undefined ? undefined : reviewSummary(data);
  return (
    <Dialog
      open={binding.open && data !== undefined}
      onOpenChange={binding.onOpenChange}
      label={m.review_gone_title()}
      showTitle
    >
      {data === undefined || summary === undefined ? null : (
        <>
          {summary.goneStreams > 0 ? (
            <p className="-mt-2 px-4 text-meta text-fg-2 sm:px-5.5">
              {m.review_gone_subtitle({
                count: summary.goneStreams,
                sources: formatList(summary.goneSources),
              })}
            </p>
          ) : null}
          <GoneBody entries={goneChannels(data)} onDone={() => void overlay.close()} />
        </>
      )}
    </Dialog>
  );
}
