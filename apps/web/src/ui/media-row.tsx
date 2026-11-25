import type { ReactNode } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from "~/ui/icons.ts";
import { Sk } from "~/ui/skeleton.tsx";
import { useScrollEdges } from "~/ui/use-scroll-edges.ts";
import { cn } from "~/ui/utils.ts";

/**
 * A horizontal row of cards (SPEC §4 MediaRow): scroll-snap with a peek of the next card, bleeds
 * to the gutter edge, keyboard scrollable. On wide screens with hover, arrow buttons appear, and
 * only when the row can scroll. 1.35 cards on phones, 2.3 from 600 px, 4 from 1100, 5 from 1500.
 */
export function MediaRow({ label, children }: { label: string; children: ReactNode }) {
  const { ref: rowRef, scrollable, more } = useScrollEdges<HTMLDivElement>();

  const page = (direction: 1 | -1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.9, behavior: "smooth" });
  };

  return (
    <div className="row-wrap" data-scrollable={scrollable ? "" : undefined}>
      <button
        type="button"
        className="row-arrow"
        data-side="start"
        aria-label={m.row_previous()}
        tabIndex={-1}
        disabled={!more.start}
        onClick={() => page(-1)}
      >
        <span className="row-arrow-disc">
          <Icon icon={ChevronLeftIcon} />
        </span>
      </button>
      {/* A scrollable region keyboard users can focus and move with the arrow keys. */}
      <div ref={rowRef} className="row" role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
      <button
        type="button"
        className="row-arrow"
        data-side="end"
        aria-label={m.row_next()}
        tabIndex={-1}
        disabled={!more.end}
        onClick={() => page(1)}
      >
        <span className="row-arrow-disc">
          <Icon icon={ChevronRightIcon} />
        </span>
      </button>
    </div>
  );
}

/** What a media card shows besides its artwork. */
export interface MediaCardProps {
  /** The artwork (an `<Artwork>`), in its fixed 16:9 box. */
  readonly art: ReactNode;
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** Badges top-left on the art (Live, Rec, Conflict). */
  readonly badges?: ReactNode | undefined;
  /** A pill bottom-left on the art ("Tomorrow 17:00"). */
  readonly when?: ReactNode | undefined;
  /** Watched share 0 to 1 (amber), or the live progress (red) with `live`. */
  readonly progress?: number | undefined;
  readonly live?: boolean;
  /** Marks a recording this profile has not started. */
  readonly isNew?: boolean;
  /** The whole card is one link or button: pass the element to render (`<Link to=… />`). */
  readonly render: (props: { className: string; children: ReactNode }) => ReactNode;
  readonly className?: string;
}

/**
 * A media card (SPEC §4 MediaCard): the art lifts 2 px on hover with a play glyph, the focus
 * ring sits on the art, a progress bar on the art, badges top-left. Title and subtitle are one
 * line with an ellipsis. Every text from data is a skeleton while its route loads.
 */
export function MediaCard({
  art,
  title,
  subtitle,
  badges,
  when,
  progress,
  live = false,
  isNew = false,
  render,
  className,
}: MediaCardProps) {
  return render({
    className: cn("card", className),
    children: (
      <>
        <span className="card-media">
          {art}
          {badges === undefined ? null : <span className="card-badges sk-hide">{badges}</span>}
          {when === undefined ? null : <span className="card-when sk-hide">{when}</span>}
          {progress === undefined ? null : (
            <span className="card-progress sk-hide" data-live={live ? "" : undefined}>
              <span
                className="card-progress-fill block"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
              />
            </span>
          )}
          <span className="card-play" aria-hidden="true">
            <span className="card-play-disc">
              <Icon icon={PlayIcon} />
            </span>
          </span>
        </span>
        <span className="card-meta">
          <span className="card-title">
            {isNew ? <span className="card-new" aria-label={m.status_new()} /> : null}
            <Sk placeholder={title}>{title}</Sk>
          </span>
          {subtitle === undefined ? null : (
            <span className="card-sub">
              <Sk placeholder={subtitle}>{subtitle}</Sk>
            </span>
          )}
        </span>
      </>
    ),
  });
}
