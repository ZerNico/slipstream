import { useQuery } from "@tanstack/react-query";
import {
  type Channel,
  type ChannelId,
  parseLineupNumber,
  previewNumberMove,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useRef, useState } from "react";
import { Field } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { numberMoveText } from "./model.ts";
import { useLineupQueries, usePlaceNumbers, useRemoveChannels } from "./queries.ts";

const notSaved = () => toast({ title: m.state_not_saved(), type: "error" });

/**
 * Move to number…: the chosen channels take consecutive numbers from the one typed, in their
 * order; the line under the field says what happens before anything is saved.
 */
export function MoveDialog({
  channels,
  lineup,
  open,
  onOpenChange,
}: {
  channels: readonly Channel[];
  lineup: readonly Channel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const place = usePlaceNumbers();
  const field = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(() =>
    channels[0]?.number === undefined ? "" : String(channels[0].number),
  );
  const start = parseLineupNumber(text);
  const ids = channels.map((channel) => channel.id);
  const move = start === undefined ? undefined : previewNumberMove(lineup, ids, start);
  const submit = () => {
    if (start === undefined) return;
    place.mutate({ ids, start }, { onSuccess: () => onOpenChange(false), onError: notSaved });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={m.lineup_move_title({ count: channels.length })}
      showTitle
      size="sm"
      keyboardFocus={field}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.action_cancel()}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="lineup-move"
            disabled={start === undefined}
            busy={place.isPending}
          >
            {m.lineup_move_action()}
          </Button>
        </>
      }
    >
      <form
        id="lineup-move"
        className="grid gap-4 p-5.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <ul className="flex flex-wrap gap-1.5" aria-label={m.channels_heading()}>
          {channels.slice(0, 8).map((channel) => (
            <li key={channel.id} className="rounded-md bg-raised px-2 py-0.5 text-meta text-fg-2">
              {channel.name}
            </li>
          ))}
          {channels.length > 8 ? (
            <li className="px-1 py-0.5 text-meta text-fg-3">
              {m.channels_count({ count: channels.length - 8 })}
            </li>
          ) : null}
        </ul>
        <Field
          label={m.lineup_number_field()}
          htmlFor="lineup-move-number"
          hint={move === undefined ? m.lineup_number_invalid() : numberMoveText(move)}
        >
          <Input
            ref={field}
            id="lineup-move-number"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            aria-invalid={text.trim() !== "" && start === undefined}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Remove, gently: recordings stay and the streams go back to their sources. When one-off
 * recordings are still scheduled on the channels, it says they will be cancelled.
 */
export function RemoveDialog({
  channels,
  open,
  onOpenChange,
  onRemoved,
}: {
  channels: readonly Channel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: (ids: readonly ChannelId[]) => void;
}) {
  const queries = useLineupQueries();
  const remove = useRemoveChannels();
  const ids = channels.map((channel) => channel.id);
  const preview = useQuery({ ...queries.removePreview(ids), enabled: open && ids.length > 0 });
  const scheduled = preview.data?.scheduledRecordings ?? 0;
  const [only] = channels;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={
        channels.length === 1 && only !== undefined
          ? m.lineup_remove_named({ name: only.name })
          : m.lineup_remove_many({ count: channels.length })
      }
      showTitle
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.action_cancel()}
          </Button>
          <Button
            variant="danger"
            busy={remove.isPending}
            disabled={preview.isPending}
            onClick={() =>
              remove.mutate(ids, {
                onSuccess: () => {
                  toast({ title: m.lineup_removed({ count: ids.length }) });
                  onRemoved(ids);
                  onOpenChange(false);
                },
                onError: notSaved,
              })
            }
          >
            {m.lineup_remove()}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 p-5.5 text-fg-2">
        <p>{m.lineup_remove_body()}</p>
        {/* The line has its place while the count loads, so the dialog keeps its height. */}
        <p className={scheduled > 0 ? "font-semibold text-warn-fg" : "sr-only"}>
          {scheduled > 0 ? m.lineup_remove_cancels({ count: scheduled }) : null}
        </p>
      </div>
    </Dialog>
  );
}
