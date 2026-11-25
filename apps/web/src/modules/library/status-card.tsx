import type { ReactNode } from "react";
import { m } from "@slipstream/i18n";
import { Icon, type IconSvgElement } from "~/ui/icon.tsx";
import { CloseIcon } from "~/ui/icons.ts";
import { IconButton } from "~/ui/primitives/button.tsx";
import { cn } from "~/ui/utils.ts";

/**
 * A card in an issue slot that is good news or a one-time notice rather than a problem: "Tatort
 * replaced by the repeat from Wed 25" (ok) or "Series recordings now leave out episodes you
 * already have" (info). The same box as an issue card (`.issue`), so it takes the slot without
 * changing its geometry; only the icon's tint differs.
 */
export function StatusCard({
  tone,
  icon,
  title,
  text,
  actions,
  onDismiss,
}: {
  tone: "ok" | "info";
  icon: IconSvgElement;
  title: string;
  text?: string | undefined;
  actions?: ReactNode;
  onDismiss?: (() => void) | undefined;
}) {
  return (
    <article className="issue" data-tone={tone}>
      <span
        className={cn(
          "issue-icon sk-hide",
          tone === "ok" ? "bg-ok-soft text-ok-fg" : "bg-brand-soft text-brand-fg",
        )}
        aria-hidden="true"
      >
        <Icon icon={icon} />
      </span>
      <h3 className="issue-title">
        <span className="sk">{title}</span>
      </h3>
      {text === undefined ? null : (
        <p className="issue-text">
          <span className="sk">{text}</span>
        </p>
      )}
      {actions === undefined ? null : <div className="issue-actions">{actions}</div>}
      {onDismiss ? (
        <span className="issue-dismiss">
          <IconButton label={m.action_dismiss()} size="sm" onClick={onDismiss}>
            <Icon icon={CloseIcon} size={16} />
          </IconButton>
        </span>
      ) : null}
    </article>
  );
}
