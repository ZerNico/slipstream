import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, CloseIcon } from "~/ui/icons.ts";
import { Button, IconButton } from "~/ui/primitives/button.tsx";

/**
 * An editor's save bar (SPEC §2.2): fixed beside the rail under 1100 px, a sticky glass card at
 * the bottom of the form column from 1100 px. One 64 px row (48 px in short landscape).
 */
export function SaveBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-save-bar=""
      className="fixed right-0 bottom-[calc(var(--tab-h)+var(--safe-b))] left-(--rail-w) z-35 border-t border-line bg-nav-bg backdrop-blur-xl lg:sticky lg:bottom-4 lg:mt-4 lg:rounded-lg lg:border-0 lg:bg-glass lg:shadow-pop"
    >
      <div className="wrap flex h-16 items-center gap-2.5 lg:px-3 short:h-12">{children}</div>
    </div>
  );
}

/**
 * The save bar's usual row: the primary (it never shrinks), Cancel (an icon under 640 px), then
 * whatever the editor adds at the end.
 */
export function SaveActions({
  label,
  busy,
  submit = false,
  onSave,
  cancel,
  children,
}: {
  label: string;
  busy: boolean;
  /** Submits the form the bar sits in, instead of calling `onSave`. */
  submit?: boolean;
  onSave?: () => void;
  /** Where Cancel goes. */
  cancel: LinkProps;
  children?: ReactNode;
}) {
  return (
    <>
      <Button
        type={submit ? "submit" : "button"}
        variant="primary"
        className="shrink-0"
        busy={busy}
        icon={<Icon icon={CheckIcon} />}
        {...(onSave === undefined ? {} : { onClick: onSave })}
      >
        {label}
      </Button>
      <Button
        variant="ghost"
        className="shrink-0 max-sm:hidden"
        nativeButton={false}
        render={<Link {...cancel} />}
      >
        {m.action_cancel()}
      </Button>
      <IconButton
        label={m.action_cancel()}
        className="shrink-0 sm:hidden"
        nativeButton={false}
        render={<Link {...cancel} />}
      >
        <Icon icon={CloseIcon} />
      </IconButton>
      <span className="flex-1" />
      {children}
    </>
  );
}
