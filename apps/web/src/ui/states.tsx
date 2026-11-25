import type { ReactNode } from "react";
import { m } from "@slipstream/i18n";
import { Icon, type IconSvgElement } from "~/ui/icon.tsx";
import { CloseIcon, WarningIcon } from "~/ui/icons.ts";
import { IconButton } from "~/ui/primitives/button.tsx";

/**
 * An empty state (SPEC §4): a small illustration, one sentence, the primary fix. Never a
 * spinner, never a bare "No data".
 */
export function EmptyState({
  title,
  text,
  action,
  page = false,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  /** It is the whole screen (no page heading above it): its title is the page's `h1`. */
  page?: boolean;
}) {
  const Heading = page ? "h1" : "h2";
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <i />
        <i />
      </div>
      <Heading className="type-h3">{title}</Heading>
      {text === undefined ? null : <p className="empty-text">{text}</p>}
      {action}
    </div>
  );
}

/**
 * A failure that replaces a screen's content (SPEC §8.9): a statement title, what happened, and
 * the fixes next to the problem (primary first).
 */
export function ErrorState({
  title,
  text,
  actions,
}: {
  title: string;
  text?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="empty" role="alert">
      <span className="error-icon" aria-hidden="true">
        <Icon icon={WarningIcon} size={24} />
      </span>
      <h2 className="type-h3">{title}</h2>
      {text === undefined ? null : <p className="empty-text">{text}</p>}
      {actions === undefined ? null : <div className="issue-actions justify-center">{actions}</div>}
    </div>
  );
}

/**
 * A problem with its fix (SPEC §4 IssueCard): icon, a statement title, the explanation, the
 * actions; dismissing shows a toast with Undo (the caller's `onDismiss` does that).
 */
export function ProblemCard({
  tone,
  icon = WarningIcon,
  title,
  text,
  actions,
  onDismiss,
}: {
  tone: "err" | "warn";
  icon?: IconSvgElement;
  title: string;
  text: string;
  actions?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <article className="issue" data-tone={tone}>
      <span className="issue-icon sk-hide" aria-hidden="true">
        <Icon icon={icon} />
      </span>
      <h3 className="issue-title">
        <span className="sk">{title}</span>
      </h3>
      <p className="issue-text">
        <span className="sk">{text}</span>
      </p>
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
