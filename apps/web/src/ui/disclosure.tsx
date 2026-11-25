import { type ReactNode, useId } from "react";
import { Icon } from "~/ui/icon.tsx";
import { ChevronDownIcon } from "~/ui/icons.ts";
import { cn } from "~/ui/utils.ts";

/**
 * A folded part of an editor's form panel (the series recording's Options, the collection's
 * Advanced): one heading row that opens it, with what it is set to on the right when there is a
 * summary. Opening it is a change the person asked for, so what follows may move then.
 */
export function FormDisclosure({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** What the folded part is set to, beside the title. */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="border-t border-line" data-disclosure={open ? "open" : "closed"}>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex min-h-tap w-full items-center gap-3 px-5 py-3 text-left font-sans text-[15px] font-[650] tracking-normal fine:hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <span>{title}</span>
          {summary === undefined ? null : (
            <span
              className="ml-auto min-w-0 truncate text-[14px] font-normal text-fg-2"
              data-disclosure-summary=""
            >
              {summary}
            </span>
          )}
          <Icon
            icon={ChevronDownIcon}
            size={16}
            className={cn(
              "flex-none text-fg-3 transition-transform duration-(--t-fast)",
              summary === undefined && "ml-auto",
              open && "rotate-180",
            )}
          />
        </button>
      </h2>
      <div id={id} hidden={!open} className="border-t border-line">
        {children}
      </div>
    </section>
  );
}
