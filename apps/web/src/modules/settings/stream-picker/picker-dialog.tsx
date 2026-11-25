import type { SourceView } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "~/ui/primitives/dialog.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { ResultNote } from "~/ui/result-note.tsx";
import { Sk } from "~/ui/skeleton.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { problemTitle } from "~/api/problem-title.ts";
import { useAddStreams } from "./api.ts";
import { pickerArg } from "./open-picker.ts";
import { addLabel } from "./picker-text.ts";
import { PickerCount, StreamPickerList } from "./stream-picker.tsx";
import { useStreamPicker } from "./use-stream-picker.ts";

/** The words a finished add leaves in a toast ("1,186 channels added"). */
const addedText = (added: { created: readonly unknown[]; joined: readonly unknown[] }) =>
  m.picker_done({ created: added.created.length, joined: added.joined.length });

/** The picker as a whole: heading, list, count and Add. Mounted while the dialog is open. */
function PickerBody({
  source,
  onlyNew,
  onDone,
}: {
  source: SourceView;
  onlyNew: boolean;
  onDone: () => void;
}) {
  const picker = useStreamPicker(source.id, { onlyNew });
  const add = useAddStreams();
  return (
    <>
      <div className="grid gap-0.5 px-5.5 pt-5.5">
        <DialogTitle>{m.picker_title()}</DialogTitle>
        <p className="text-meta text-fg-2">
          <Sk chars={32}>
            {picker.loading
              ? ""
              : m.picker_subtitle({
                  source: source.name,
                  streams: picker.groups.reduce((sum, group) => sum + group.streams, 0),
                  groups: picker.groups.length,
                })}
          </Sk>
        </p>
      </div>
      <div className="grid min-h-0 flex-1 px-5.5 pt-4 pb-3">
        <StreamPickerList picker={picker} className="min-h-60" />
      </div>
      {add.isError ? (
        <div className="px-5.5 pb-3">
          <ResultNote tone="error">{problemTitle(add.error)}</ResultNote>
        </div>
      ) : null}
      <DialogFooter className="items-center">
        <Button variant="ghost" className="mr-auto" onClick={onDone}>
          {m.action_cancel()}
        </Button>
        <PickerCount picker={picker} />
        <Button
          variant="primary"
          busy={add.isPending}
          disabled={picker.streamsLoading || picker.selected === 0}
          onClick={() =>
            add.mutate(
              { id: source.id, streamIds: picker.pickedIds() },
              {
                onSuccess: (added) => {
                  toast({ title: addedText(added), type: "success" });
                  onDone();
                },
              },
            )
          }
        >
          {addLabel(picker)}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * `?dlg=streams:<sourceId>`: choose which streams of a source become channels (Settings ›
 * Sources, after adding a big playlist or from a source's card). A wide dialog with a fixed
 * height, so the list scrolls inside it and the footer stays.
 */
export function StreamPickerDialog({ sources }: { sources: readonly SourceView[] }) {
  const binding = useOverlayBinding("dlg", "streams");
  const overlay = useOverlay();
  const arg = pickerArg(binding.overlay?.arg);
  const source = sources.find((candidate) => candidate.id === arg.id);
  return (
    <DialogRoot open={binding.open && source !== undefined} onOpenChange={binding.onOpenChange}>
      <DialogContent className="flex h-[min(780px,calc(100dvh-var(--dialog-top)-var(--safe-b)-16px))] w-[min(960px,calc(100vw-24px))] flex-col overflow-hidden">
        {source === undefined ? null : (
          <PickerBody
            key={source.id}
            source={source}
            onlyNew={arg.onlyNew}
            onDone={() => void overlay.close()}
          />
        )}
      </DialogContent>
    </DialogRoot>
  );
}
