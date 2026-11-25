import { Link } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef } from "react";
import { m } from "@slipstream/i18n";
import { focusAfterRender } from "~/ui/focus-after-render.ts";
import { Icon } from "~/ui/icon.tsx";
import { DeleteIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { SaveActions, SaveBar } from "~/ui/save-bar.tsx";
import { cn } from "~/ui/utils.ts";

/** The series recording editor's save bar (SPEC §2.2). It always states the effect. */
export function SeriesSaveBar({
  isNew,
  editable,
  ownerName,
  count,
  busy,
  deleting,
  confirmDelete,
  deleteRef,
  onAskDelete,
  onConfirmDelete,
  onSave,
  onDelete,
  problem,
}: {
  isNew: boolean;
  editable: boolean;
  ownerName: string;
  count: number;
  busy: boolean;
  deleting: boolean;
  confirmDelete: boolean;
  /** The save bar's Delete, where focus goes back after asking. */
  deleteRef: RefObject<HTMLButtonElement | null>;
  /** Delete pressed: asks in the bar, or in a dialog when a collection follows. */
  onAskDelete: () => void;
  onConfirmDelete: (open: boolean) => void;
  onSave: () => void;
  onDelete: () => void;
  problem: string | undefined;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmDelete) keepRef.current?.focus();
  }, [confirmDelete]);
  return (
    <SaveBar>
      {!editable ? (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] text-fg-2">
            {m.series_read_only_bar({ owner: ownerName })}
          </span>
          <Button variant="ghost" nativeButton={false} render={<Link to="/series" />}>
            {m.series_back()}
          </Button>
        </>
      ) : confirmDelete ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg" role="status">
            {m.series_delete_confirm()}
          </span>
          <Button variant="danger" busy={deleting} onClick={onDelete}>
            {m.series_delete_yes()}
          </Button>
          <Button
            ref={keepRef}
            variant="ghost"
            onClick={() => {
              onConfirmDelete(false);
              focusAfterRender(deleteRef);
            }}
          >
            {m.series_delete_keep()}
          </Button>
        </>
      ) : (
        <SaveActions
          label={isNew ? m.series_create() : m.action_save()}
          busy={busy}
          onSave={onSave}
          cancel={{ to: "/series" }}
        >
          {problem === undefined ? null : (
            <span role="alert" className="min-w-0 truncate text-[13px] text-live-fg">
              {problem}
            </span>
          )}
          <a
            href="#rule-preview"
            className={cn(
              "inline-flex h-ctl-md shrink-0 items-center rounded-full px-3 text-[14px] font-semibold whitespace-nowrap text-ok-fg sm:hidden",
              problem !== undefined && "hidden",
            )}
          >
            {m.series_preview_jump({ count })}
          </a>
          {isNew ? null : (
            <Button
              ref={deleteRef}
              variant="ghost"
              className="max-sm:hidden"
              icon={<Icon icon={DeleteIcon} />}
              onClick={onAskDelete}
            >
              {m.action_delete()}
            </Button>
          )}
        </SaveActions>
      )}
    </SaveBar>
  );
}
