import { type Channel, parseLineupNumber, previewNumberMove } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { type Ref, useState } from "react";
import { Kbd } from "~/ui/primitives/kbd.tsx";
import { cn } from "~/ui/utils.ts";
import { numberMoveText } from "./model.ts";

/**
 * A channel's number, typed in place: it reads as the number until clicked; typing shows what
 * Enter will do beside it ("Move to 6 · VOX HD moves to 7"), Enter saves, Esc or leaving the
 * field puts the number back. The hint floats over the row, so nothing moves.
 */
export function NumberField({
  channel,
  lineup,
  onSave,
  inputRef,
  className,
}: {
  channel: Channel;
  lineup: readonly Channel[];
  onSave: (number: number) => void;
  inputRef?: Ref<HTMLInputElement> | undefined;
  className?: string;
}) {
  const current = channel.number === undefined ? "" : String(channel.number);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const typed = draft === undefined ? undefined : parseLineupNumber(draft);
  const move =
    typed === undefined || typed === channel.number
      ? undefined
      : previewNumberMove(lineup, [channel.id], typed);
  return (
    <span className={cn("relative flex-none", className)}>
      <input
        ref={inputRef}
        aria-label={m.lineup_number_of({ name: channel.name })}
        inputMode="numeric"
        autoComplete="off"
        value={draft ?? current}
        aria-invalid={draft !== undefined && draft.trim() !== "" && typed === undefined}
        className={cn(
          "h-8 w-12 rounded-md border border-transparent bg-transparent px-1.5 text-right text-fg-2 tabular-nums outline-none",
          "fine:hover:border-line focus:border-brand focus:bg-sunken focus:text-fg aria-invalid:border-live",
        )}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(undefined)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            if (typed !== undefined && typed !== channel.number) onSave(typed);
            setDraft(undefined);
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(undefined);
            event.currentTarget.blur();
          }
        }}
      />
      {move === undefined ? null : (
        <span
          role="status"
          className="pointer-events-none absolute top-1/2 left-[calc(100%+8px)] z-2 flex -translate-y-1/2 items-center gap-2 rounded-md bg-raised px-2.5 py-1.5 text-meta whitespace-nowrap text-fg shadow-pop"
        >
          {numberMoveText(move)}
          <Kbd>↵</Kbd>
        </span>
      )}
    </span>
  );
}
