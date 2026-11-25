import { useEffect, useRef, useState } from "react";
import { m } from "@slipstream/i18n";
import { focusAfterRender } from "~/ui/focus-after-render.ts";
import { Button } from "~/ui/primitives/button.tsx";

/**
 * "12 deleted episodes won't be recorded again · Forget them" (recording model §3.2): the
 * viewer's episode history for this series recording, cleared after a confirm in place.
 */
export function HistoryLine({
  count,
  busy,
  onForget,
}: {
  count: number;
  busy: boolean;
  onForget: (onDone: () => void) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  const forgetRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) yesRef.current?.focus();
  }, [confirming]);
  return (
    <div
      data-history=""
      className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-hover px-3 py-1.5 text-[13px] text-fg-2"
    >
      {confirming ? (
        <>
          <span className="min-w-0 flex-1" role="status">
            {m.series_history_confirm()}
          </span>
          <Button
            ref={yesRef}
            type="button"
            variant="ghost"
            size="sm"
            busy={busy}
            onClick={() => onForget(() => setConfirming(false))}
          >
            {m.series_history_forget()}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirming(false);
              focusAfterRender(forgetRef);
            }}
          >
            {m.action_cancel()}
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">{m.series_history({ count })}</span>
          <Button
            ref={forgetRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            {m.series_history_forget()}
          </Button>
        </>
      )}
    </div>
  );
}
