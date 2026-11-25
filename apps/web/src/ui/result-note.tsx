import type { ReactNode } from "react";
import { Icon } from "~/ui/icon.tsx";
import { SuccessIcon, WarningIcon } from "~/ui/icons.ts";
import { cn } from "~/ui/utils.ts";

/**
 * A result line under a form or a card ("Works: 212 streams…", "Unreachable since 17:20"):
 * green for a pass, red for a failure, with its icon.
 */
export function ResultNote({
  tone,
  title,
  children,
}: {
  tone: "ok" | "error";
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[13.5px]",
        tone === "ok" ? "bg-ok-soft" : "bg-live-soft",
      )}
    >
      <Icon
        icon={tone === "ok" ? SuccessIcon : WarningIcon}
        size={20}
        className={tone === "ok" ? "text-ok-fg" : "text-live-fg"}
      />
      <div className="min-w-0">
        {title === undefined ? null : <b className="font-semibold">{title} </b>}
        {children}
      </div>
    </div>
  );
}
