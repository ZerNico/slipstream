import { Link, useNavigate } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef } from "react";
import type { RecordingId, RuleId } from "@slipstream/domain";
import { useDeleteRecording, useSaveProgress, useUpdateRecording } from "~/api/mutations.ts";
import { formatBytes } from "~/i18n/formats.ts";
import { dayPill, m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, DeleteIcon, EditIcon, MoreIcon, PlayIcon, ProtectIcon } from "~/ui/icons.ts";
import { MenuItem, MenuSeparator, ResponsiveMenu } from "~/ui/menu.tsx";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { type DeleteChoice, deleteRequest, type PrimaryAction, primaryLabel } from "./detail.ts";
import { recordedSpan, type Entry } from "./library.ts";

const failedToast = () => toast({ title: m.library_action_failed(), type: "error" });

/**
 * The detail's action row. Failed: Delete. Scheduled: when it starts, Skip this and the series
 * recording's options. Otherwise: Play (or the watch choice), Protect and the ⋯ menu with Mark
 * as watched and Delete.
 */
export function RecordingActions({
  id,
  entry,
  action,
  choice,
  failed,
  scheduled,
  editRule,
  now,
  timeZone,
  moreRef,
  onOpenChoice,
  onAskDelete,
}: {
  id: RecordingId;
  entry: Entry | undefined;
  action: PrimaryAction;
  /** Play opens the watch choice instead of playing from the start. */
  choice: boolean;
  failed: boolean;
  scheduled: boolean;
  /** The series recording this profile may change, for "Series options". */
  editRule: RuleId | undefined;
  now: number;
  timeZone: string | undefined;
  /** Around the ⋯ button, where focus returns when Delete is not confirmed. */
  moreRef: RefObject<HTMLSpanElement | null>;
  onOpenChoice: () => void;
  onAskDelete: () => void;
}) {
  const navigate = useNavigate();
  const update = useUpdateRecording();
  const skip = useDeleteRecording();
  const progress = useSaveProgress();
  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="lg" variant="danger" icon={<Icon icon={DeleteIcon} />} onClick={onAskDelete}>
          {m.action_delete()}
        </Button>
      </div>
    );
  }
  if (entry && scheduled) {
    const start = recordedSpan(entry).start;
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        {/* What happens next, where Play sits once it recorded: "Starts Tue 24 · 16:40". */}
        <span className="inline-flex h-(--ctl-lg) min-w-0 items-center pr-1 text-[17px] font-semibold tabular-nums">
          {m.library_starts({ day: dayPill(start, now, timeZone), start: new Date(start) })}
        </span>
        <Button
          size="lg"
          variant="secondary"
          busy={skip.isPending}
          onClick={() =>
            skip.mutate(
              { id: entry.id },
              {
                onSuccess: () => {
                  toast({ title: m.guide_skipped({ title: entry.title }) });
                  void navigate({ to: "/recordings/scheduled", replace: true });
                },
                onError: failedToast,
              },
            )
          }
        >
          {m.guide_skip_this()}
        </Button>
        {editRule === undefined ? null : (
          <Button
            size="lg"
            variant="ghost"
            icon={<Icon icon={EditIcon} />}
            nativeButton={false}
            render={<Link to="/series/$id" params={{ id: editRule }} />}
          >
            {m.guide_series_options()}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {entry !== undefined && action.kind === "none" ? null : choice ? (
        <Button size="lg" variant="primary" icon={<Icon icon={PlayIcon} />} onClick={onOpenChoice}>
          {entry ? primaryLabel(entry) : m.player_play()}
        </Button>
      ) : (
        <Button
          size="lg"
          variant="primary"
          icon={<Icon icon={PlayIcon} />}
          nativeButton={false}
          render={<Link to="/watch/rec/$id" params={{ id }} search={{ at: "start" }} />}
        >
          {m.player_play()}
        </Button>
      )}
      <Button
        size="lg"
        aria-pressed={entry?.protected ?? false}
        icon={<Icon icon={entry?.protected ? CheckIcon : ProtectIcon} />}
        busy={update.isPending}
        onClick={() =>
          entry &&
          update.mutate(
            { id: entry.id, update: { protected: !entry.protected } },
            {
              onSuccess: (next) =>
                toast({
                  title: next.protected
                    ? m.library_protected_toast()
                    : m.library_unprotected_toast(),
                }),
              onError: failedToast,
            },
          )
        }
      >
        {entry?.protected ? m.recordings_protected() : m.library_protect()}
      </Button>
      <span ref={moreRef} className="contents">
        <ResponsiveMenu
          name="more"
          label={m.library_more()}
          trigger={
            <IconButton label={m.library_more()} variant="outline" size="lg">
              <Icon icon={MoreIcon} />
            </IconButton>
          }
        >
          <MenuItem
            icon={<Icon icon={CheckIcon} size={16} />}
            disabled={entry?.watched ?? true}
            onSelect={() =>
              entry &&
              progress.mutate(
                {
                  target: { _tag: "Recording", recordingId: entry.id },
                  positionMillis: 0,
                  watched: true,
                },
                { onSuccess: () => toast({ title: m.library_marked_watched() }) },
              )
            }
          >
            {m.library_mark_watched()}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Icon icon={DeleteIcon} size={16} />} onSelect={onAskDelete}>
            {m.library_delete_ask()}
          </MenuItem>
        </ResponsiveMenu>
      </span>
    </div>
  );
}

/**
 * The inline Delete question: Keep or Delete, and for a recording a series recording made, the
 * second answer (record the episode again, or stop looking for its repeat).
 */
export function DeleteConfirm({
  entry,
  choice,
  onKeep,
}: {
  entry: Entry;
  choice: DeleteChoice;
  onKeep: () => void;
}) {
  const navigate = useNavigate();
  const remove = useDeleteRecording();
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    deleteRef.current?.focus();
  }, []);
  const removeWith = (second: boolean) =>
    remove.mutate(deleteRequest(entry.id, choice, second), {
      onSuccess: () => {
        toast({ title: m.library_deleted({ title: entry.title }) });
        void navigate({ to: "/recordings", replace: true });
      },
      onError: failedToast,
    });
  const secondPending =
    remove.variables?.history !== undefined || remove.variables?.rerun !== undefined;
  return (
    <div
      role="alert"
      data-delete-confirm={choice}
      className={cn(
        "grid gap-2 bg-live-soft py-2.5 pr-3 pl-3.5 text-[13.5px] font-medium",
        choice === "plain" ? "rounded-[999px]" : "rounded-lg",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Icon icon={DeleteIcon} size={16} className="shrink-0" />
        <span className="min-w-0 flex-1">
          {m.library_delete_question({ size: formatBytes(entry.sizeBytes) })}
        </span>
        <Button size="sm" variant="ghost" onClick={onKeep}>
          {m.library_keep()}
        </Button>
        <Button
          ref={deleteRef}
          size="sm"
          variant="live"
          busy={remove.isPending && !secondPending}
          onClick={() => removeWith(false)}
        >
          {m.action_delete()}
        </Button>
        {choice === "plain" ? null : (
          <Button
            size="sm"
            variant="secondary"
            busy={remove.isPending && secondPending}
            onClick={() => removeWith(true)}
          >
            {choice === "episode"
              ? m.library_delete_record_again()
              : m.library_delete_stop_looking()}
          </Button>
        )}
      </div>
    </div>
  );
}
