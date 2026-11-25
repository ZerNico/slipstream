import { type RefObject, useState } from "react";
import { m } from "@slipstream/i18n";
import { Dialog } from "~/ui/dialog.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Checkbox } from "~/ui/primitives/checkbox.tsx";

/**
 * Deleting a series recording a collection follows (recording model §3.4): the collection stays
 * with today's conditions unless the box is ticked.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  name,
  collection,
  busy,
  onDelete,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  collection: string;
  busy: boolean;
  onDelete: (collection: "keep" | "remove") => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const [remove, setRemove] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={m.series_delete_title({ name })}
      showTitle
      size="sm"
      returnFocus={returnFocus}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.series_delete_keep()}
          </Button>
          <Button variant="danger" busy={busy} onClick={() => onDelete(remove ? "remove" : "keep")}>
            {m.series_delete_yes()}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 p-5.5">
        <p className="text-[14px] text-fg-2">{m.series_delete_text()}</p>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-[550]">
          <Checkbox checked={remove} onCheckedChange={setRemove} />
          {m.series_delete_remove_collection({ collection })}
        </label>
      </div>
    </Dialog>
  );
}
