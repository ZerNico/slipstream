import { type ReactNode, type Ref } from "react";
import type { Padding } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { MinutesSelect } from "~/ui/minutes-select.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, CloseIcon, RecordIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { cn } from "~/ui/utils.ts";

/** A status row: an icon in the state's colour, a title, a sub line and an optional action. */
export function StatusBox({
  icon,
  tone,
  title,
  sub,
  action,
  flat = false,
  ...data
}: {
  icon: ReactNode;
  tone: "live" | "brand" | "neutral";
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  flat?: boolean;
  "data-had-status"?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5",
        !flat && "rounded-lg shadow-[inset_0_0_0_1px_var(--line-2)]",
      )}
      {...data}
    >
      <span
        className={tone === "live" ? "text-live" : tone === "brand" ? "text-brand-fg" : "text-fg-3"}
      >
        {icon}
      </span>
      <div className="grid min-w-0">
        <span className="text-[14.5px] font-semibold">{title}</span>
        {sub === undefined ? null : <span className="text-[13px] text-fg-2">{sub}</span>}
      </div>
      {action ?? <span />}
    </div>
  );
}

/**
 * The box of a programme the viewer records (SPEC §8.3): Recording now / Will be recorded / In
 * conflict, by hand or by a series recording, then the extra time after the end for this
 * recording only and, while it records, Stop recording. `offer` is the collection offer's step,
 * shown between the two when open. The box takes focus when that step closes.
 */
export function RecordedStatus({
  ref,
  recording,
  title,
  sub,
  offer,
  padding,
  end,
  onKeepAfter,
  stopping,
  onStop,
}: {
  ref: Ref<HTMLDivElement>;
  /** Recording now, else scheduled. */
  recording: boolean;
  title: ReactNode;
  sub: ReactNode;
  offer: ReactNode;
  padding: Padding;
  /** The programme's end, epoch ms, for "Ends at 22:15". */
  end: number;
  onKeepAfter: (afterMinutes: number) => void;
  stopping: boolean;
  onStop: () => void;
}) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_var(--line-2)] focus-visible:outline-2 focus-visible:outline-focus"
    >
      <StatusBox
        flat
        icon={<Icon icon={recording ? RecordIcon : CheckIcon} />}
        tone={recording ? "live" : "brand"}
        title={title}
        sub={sub}
      />
      {offer}
      <div className="grid gap-2.5 border-t border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[14px]">
          <span>{m.padding_after()}</span>
          <MinutesSelect
            label={m.padding_after()}
            side="late"
            value={padding.afterMinutes}
            text={(minutes) => m.guide_minutes({ minutes })}
            onChange={onKeepAfter}
          />
        </div>
        {recording ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="type-meta">
              {m.guide_applies_once_ends({ end: new Date(end + padding.afterMinutes * 60_000) })}
            </span>
            <Button
              size="sm"
              variant="danger"
              busy={stopping}
              icon={<Icon icon={CloseIcon} size={16} />}
              onClick={onStop}
            >
              {m.guide_stop_recording()}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
