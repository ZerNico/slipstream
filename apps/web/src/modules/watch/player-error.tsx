import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { BackIcon, RefreshIcon, WarningIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";

/** A fix the error offers in its first row ("Stop arte on Kitchen Shield", primary). */
export interface ErrorFix {
  readonly label: string;
  readonly onClick: () => void;
  readonly busy?: boolean;
}

/**
 * An error over the picture (SPEC §7.1): a statement as the title, what happened in plain
 * words, then row one with the real fixes (the primary one first, Try again beside it) and row
 * two with the quiet ones (Show log, back to where you came from), all on one left edge.
 */
export function PlayerError({
  title,
  body,
  fix,
  onRetry,
  back,
}: {
  title: string;
  body?: ReactNode;
  fix?: ErrorFix;
  onRetry?: () => void;
  /** Where the quiet way out goes: the guide for live TV, the recordings otherwise. */
  back: "guide" | "recordings";
}) {
  return (
    <div
      className="absolute inset-0 z-7 grid place-items-center bg-media-scrim p-6 backdrop-blur-md"
      role="alert"
      data-player-error=""
    >
      <div className="grid max-w-115 justify-items-start gap-3.5">
        <span className="grid size-13 place-items-center rounded-lg bg-live-soft text-live-fg">
          <Icon icon={WarningIcon} size={24} />
        </span>
        <h2 className="text-h2 text-[22px] text-fg">{title}</h2>
        {body === undefined ? null : <p className="text-body text-fg-2">{body}</p>}
        {fix === undefined && onRetry === undefined ? null : (
          <div className="flex flex-wrap gap-2">
            {fix === undefined ? null : (
              <Button variant="primary" busy={fix.busy ?? false} onClick={fix.onClick}>
                {fix.label}
              </Button>
            )}
            {onRetry === undefined ? null : (
              <Button
                variant={fix === undefined ? "primary" : "secondary"}
                icon={<Icon icon={RefreshIcon} size={16} />}
                onClick={onRetry}
              >
                {m.action_try_again()}
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            icon={<Icon icon={BackIcon} size={16} />}
            nativeButton={false}
            render={<Link to={back === "guide" ? "/guide" : "/recordings"} replace />}
          >
            {back === "guide" ? m.player_back_to_guide() : m.player_back_to_recordings()}
          </Button>
        </div>
      </div>
    </div>
  );
}
