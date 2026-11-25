import { maxStreamsLimit } from "@slipstream/domain";
import { useId, useState } from "react";
import { m } from "@slipstream/i18n";
import { Stepper } from "~/ui/form-controls.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Switch } from "~/ui/primitives/switch.tsx";

/**
 * What a restricted profile or a guest may do besides seeing (SPEC §8.7): record, and how many
 * streams at once (0 is unlimited, up to the household's `maxStreamsLimit`).
 */
export function AccessOptions({
  mayRecord,
  onMayRecordChange,
  streams,
  onStreamsChange,
}: {
  mayRecord: boolean;
  onMayRecordChange: (mayRecord: boolean) => void;
  streams: number;
  onStreamsChange: (streams: number) => void;
}) {
  const id = useId();
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold" id={`${id}-record`}>
            {m.access_may_record()}
          </div>
        </div>
        <Switch
          checked={mayRecord}
          aria-labelledby={`${id}-record`}
          onCheckedChange={onMayRecordChange}
        />
      </div>
      <div className="flex items-center gap-3 max-sm:flex-wrap">
        <div className="min-w-0 flex-1 max-sm:basis-full">
          <div className="text-[14.5px] font-semibold">{m.access_streams()}</div>
        </div>
        <Stepper
          label={m.access_streams()}
          value={streams}
          display={streams === 0 ? m.access_streams_unlimited() : String(streams)}
          min={0}
          max={maxStreamsLimit}
          onChange={onStreamsChange}
        />
      </div>
    </>
  );
}

/**
 * Removing a profile or guest from its own form: a quiet button, then the question in place
 * ("Remove Anna? …") with the removal and Cancel.
 */
export function RemoveConfirm({
  name,
  label,
  confirmLabel,
  busy,
  disabled = false,
  onRemove,
}: {
  name: string;
  /** The quiet button that asks. */
  label: string;
  /** The button that removes. */
  confirmLabel: string;
  busy: boolean;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      {asking ? (
        <>
          <p className="mr-auto text-[14px] text-fg-2">{m.users_remove_confirm({ name })}</p>
          <Button size="sm" variant="danger" busy={busy} autoFocus onClick={onRemove}>
            {confirmLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            {m.action_cancel()}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setAsking(true)}>
          {label}
        </Button>
      )}
    </div>
  );
}
