import { type KeyboardEvent, useRef } from "react";
import { m, watchOptionText } from "@slipstream/i18n";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { FromStartIcon, GoLiveIcon, PlayIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import type { TimelineData } from "~/ui/timeline/geometry.ts";
import { Timeline } from "~/ui/timeline/timeline.tsx";
import { rovingIndex } from "~/ui/roving.ts";
import { type ChoiceInput, type ChoiceOption, watchChoice } from "@slipstream/domain";

/** What the watch choice shows. */
export interface WatchChoiceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The recording's title and the line under it ("Sky Sport F1 · started 42 min ago"). */
  readonly title: string;
  readonly subtitle: string;
  readonly artwork: ArtworkSubject;
  /** The recording window, live state and this profile's position. */
  readonly input: ChoiceInput;
  /** The compact timeline (window start to end, your knob, the live edge). */
  readonly timeline: TimelineData;
  readonly caption?: string;
  /** Called with the picked option; the dialog closes through `onOpenChange`. */
  readonly onPick: (option: ChoiceOption) => void;
}

/**
 * The watch choice (SPEC §7.6, Plex-like): artwork, title, compact timeline and the options,
 * the first one primary. From the keyboard the primary is focused, ↑/↓ move, Enter picks, Esc
 * cancels. Under 600 px it is a bottom sheet with the options in thumb reach; in short landscape
 * the artwork and timeline sit left of the options.
 */
export function WatchChoice({
  open,
  onOpenChange,
  title,
  subtitle,
  artwork,
  input,
  timeline,
  caption,
  onPick,
}: WatchChoiceProps) {
  const choice = watchChoice(input);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const next = rovingIndex(Math.max(0, current), buttons.length, event.key);
    if (next === undefined) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={title}
      size="sm"
      keyboardFocus={primaryRef}
    >
      <div className="choice">
        <div className="choice-head">
          <Artwork subject={artwork} noTitle />
          <div className="min-w-0">
            <b className="choice-title">{title}</b>
            <span className="choice-sub">{subtitle}</span>
          </div>
        </div>
        <div className="choice-timeline">
          <Timeline
            data={timeline}
            variant="compact"
            relative={!input.live}
            {...(caption ? { caption } : {})}
          />
        </div>
        <div
          ref={listRef}
          className="choice-options"
          role="group"
          aria-label={m.choice_options_label()}
          onKeyDown={onKeyDown}
        >
          {choice.options.map((option, index) => (
            <button
              key={option.kind}
              ref={index === 0 ? primaryRef : undefined}
              type="button"
              className="choice-option"
              data-primary={index === 0 ? "" : undefined}
              data-kind={option.kind}
              onClick={() => onPick(option)}
            >
              <span className="choice-option-icon">
                <Icon
                  icon={
                    option.kind === "live"
                      ? GoLiveIcon
                      : option.kind === "start"
                        ? FromStartIcon
                        : PlayIcon
                  }
                />
              </span>
              <span className="min-w-0">
                <span className="choice-option-label">{watchOptionText(option, input).title}</span>
                <span className="choice-option-detail">
                  {watchOptionText(option, input).detail}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="choice-cancel grid">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.action_cancel()}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
