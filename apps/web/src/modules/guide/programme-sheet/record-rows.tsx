import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { inlineLink } from "./inline-link.ts";
import { StatusBox } from "./status-box.tsx";
import type { HadTarget } from "./view-model.ts";

/** What the line about an episode the viewer has says, and where its action leads. */
export interface HadView {
  /** "Already recorded Sun 22, 15:00 on ONE" (`hadText`). */
  readonly text: string;
  readonly target: HadTarget | undefined;
  /** Opens the target: the watch choice for a copy, the planned airing's sheet. */
  readonly open: (target: HadTarget) => void;
}

const actionLabel = (target: HadTarget) =>
  target.kind === "play" ? m.guide_play_it() : m.guide_show_it();

/**
 * Owned (§3.1): "Already recorded Sun 22, 15:00 on ONE · Play it" above both record rows, which
 * stay: the viewer may still record this airing.
 */
export function HadLine({ had }: { had: HadView }) {
  const { target } = had;
  return (
    <p
      className="mb-2.5 flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-fg-2"
      data-had-status=""
    >
      <span className="text-fg-3">
        <Icon icon={CheckIcon} size={16} />
      </span>
      <span>{had.text}</span>
      {target === undefined ? null : (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className={inlineLink}
            aria-haspopup={target.kind === "play" ? "dialog" : undefined}
            onClick={() => had.open(target)}
          >
            {actionLabel(target)}
          </button>
        </>
      )}
    </p>
  );
}

/**
 * Repeat (§3.6): one of the viewer's series recordings left this airing out. The status box
 * replaces the record rows; Record anyway and Series options are in the footer.
 */
export function HadStatus({ had }: { had: HadView }) {
  const { target } = had;
  return (
    <StatusBox
      icon={<Icon icon={CheckIcon} />}
      tone="neutral"
      title={had.text}
      data-had-status=""
      action={
        target === undefined ? undefined : (
          <Button
            size="sm"
            variant="ghost"
            aria-haspopup={target.kind === "play" ? "dialog" : undefined}
            onClick={() => had.open(target)}
          >
            {actionLabel(target)}
          </Button>
        )
      }
    />
  );
}
