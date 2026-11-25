import { Link } from "@tanstack/react-router";
import { m } from "@slipstream/i18n";
import { Badge } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { StatusCard } from "~/modules/library/status-card.tsx";
import { ChevronRightIcon, CloseIcon, ServerIcon, SuccessIcon, WarningIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Section } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Sk } from "~/ui/skeleton.tsx";
import { ProblemCard } from "~/ui/states.tsx";
import type { IssueAction, IssueText } from "./shape.ts";

/** One shown card: its words and how to dismiss it (a no-op while loading). */
export interface AttentionCard {
  readonly key: string;
  readonly text: IssueText;
  readonly onDismiss: () => void;
}

const glyphs = {
  server: ServerIcon,
  failed: CloseIcon,
  warning: WarningIcon,
  check: SuccessIcon,
} as const;

function ActionButton({ action, first }: { action: IssueAction; first: boolean }) {
  const overlay = useOverlay();
  const { target } = action;
  const variant = first ? "secondary" : "ghost";
  const button = (() => {
    switch (target.to) {
      case "scheduled":
        return (
          <Button
            size="sm"
            variant={variant}
            nativeButton={false}
            render={<Link to="/recordings/scheduled" />}
          >
            {action.label}
          </Button>
        );
      case "sources":
        return (
          <Button
            size="sm"
            variant={variant}
            nativeButton={false}
            render={<Link to="/settings/$section" params={{ section: "sources" }} />}
          >
            {action.label}
          </Button>
        );
      case "detail":
        return (
          <Button
            size="sm"
            variant={variant}
            nativeButton={false}
            render={<Link to="/recordings/r/$id" params={{ id: target.id }} />}
          >
            {action.label}
          </Button>
        );
      case "choice":
        return (
          <Button
            size="sm"
            variant={variant}
            onClick={() => overlay.open({ kind: "choice", name: target.id })}
          >
            {action.label}
          </Button>
        );
    }
  })();
  return <span className="sk">{button}</span>;
}

/** The fixes on an issue card, on one line at its bottom. */
function IssueActions({ actions }: { actions: readonly IssueAction[] }) {
  return (
    <div data-issue-actions="">
      {actions.map((action, at) => (
        <ActionButton key={action.label} action={action} first={at === 0} />
      ))}
    </div>
  );
}

/** How many cards the wide layout shows: one row. */
const WIDE_CARDS = 4;

/** A problem card (error or warning), as opposed to a notice or good news. */
const isProblem = (card: AttentionCard) => card.text.tone === "err" || card.text.tone === "warn";

/**
 * Needs attention (SPEC §8.1): issue cards with the fix; dismissing hides a card on this device
 * with an Undo toast. From 1100 px one row of up to four cards shows (auto-fit, 320 px
 * minimum), then a "3 more problems" row when there are more. Under 1100 px
 * only the most severe card shows, then any notice or good-news card, followed by a compact "3
 * more problems" row to the Problems tab, so the first scroll on a phone or tablet reaches the
 * rows (open issue: phones/tablets).
 */
export function AttentionSection({ cards }: { cards: readonly AttentionCard[] }) {
  if (cards.length === 0) return null;
  // Under 1100 px the first card shows, then notices and good news (never hidden, they are
  // short-lived), then a row to the remaining problems.
  const more = cards.slice(1).filter(isProblem).length;
  // From 1100 px one row of cards at most; the rest are a row away too.
  const moreWide = cards.slice(WIDE_CARDS).filter(isProblem).length;
  // The badge counts problems only: notices and good news are not something to fix.
  const problems = cards.filter(isProblem).length;
  return (
    <Section
      aria-labelledby="home-attention"
      title={
        <>
          <span id="home-attention" className="section-head-text">
            <Sk>{m.home_needs_attention()}</Sk>
          </span>
          {problems === 0 ? null : (
            <span className="sk" data-attention-count="">
              <Badge tone="warn">{problems}</Badge>
            </span>
          )}
        </>
      }
      more={{ label: m.home_all_problems(), to: "/recordings/problems" }}
    >
      <div data-home-attention="">
        {cards.map((card, index) => {
          const { tone } = card.text;
          return (
            <div
              key={card.key}
              data-issue-rank={
                index === 0
                  ? "first"
                  : index >= WIDE_CARDS
                    ? "overflow"
                    : isProblem(card)
                      ? "rest"
                      : "status"
              }
              data-issue-id={card.key}
            >
              {tone === "ok" ? (
                <StatusCard
                  tone={tone}
                  icon={glyphs[card.text.glyph]}
                  title={card.text.title}
                  text={card.text.text === "" ? undefined : card.text.text}
                  actions={<IssueActions actions={card.text.actions} />}
                  onDismiss={card.onDismiss}
                />
              ) : (
                <ProblemCard
                  tone={tone}
                  icon={glyphs[card.text.glyph]}
                  title={card.text.title}
                  text={card.text.text}
                  actions={<IssueActions actions={card.text.actions} />}
                  onDismiss={card.onDismiss}
                />
              )}
            </div>
          );
        })}

        {more > 0 ? (
          <Link to="/recordings/problems" data-home-more-problems="">
            <span data-home-more-icon="" aria-hidden="true">
              <Icon icon={WarningIcon} size={20} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <Sk>{m.home_more_problems({ count: more })}</Sk>
            </span>
            <Icon icon={ChevronRightIcon} size={20} />
          </Link>
        ) : null}
        {moreWide > 0 ? (
          <Link to="/recordings/problems" data-home-more-problems="wide">
            <span data-home-more-icon="" aria-hidden="true">
              <Icon icon={WarningIcon} size={20} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <Sk>{m.home_more_problems({ count: moreWide })}</Sk>
            </span>
            <Icon icon={ChevronRightIcon} size={20} />
          </Link>
        ) : null}
      </div>
    </Section>
  );
}
