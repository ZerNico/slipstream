import { Link, type NavigateOptions } from "@tanstack/react-router";
import { extendStepMinutes } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import { Badge } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, CloseIcon } from "~/ui/icons.ts";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { cn } from "~/ui/utils.ts";

/** One row in the panel's lists: a sibling session, a programme up next, a channel. */
export interface PanelItem {
  readonly key: string;
  readonly title: string;
  readonly meta: string;
  readonly subject: ArtworkSubject;
  readonly badge?: "rec" | "sched";
  /** Watched share (amber) or how far the programme on air is (red), 0 to 1. */
  readonly progress?: { readonly value: number; readonly tone: "brand" | "live" };
  /** The item playing now. */
  readonly current?: boolean;
  /** Scheduled, not yet recorded: drawn quieter. */
  readonly ghost?: boolean;
  readonly link?: NavigateOptions;
  readonly onSelect?: () => void;
}

/** A Details row: what, and its value; `warn` for capture gaps. */
export interface DetailRow {
  readonly label: string;
  readonly value: string;
  readonly warn?: boolean;
}

/** The panel's tabs: siblings or up next, channels, details. */
export type PanelTab = "next" | "channels" | "details";

/** A list of panel rows; links replace the player's history entry, so Back leaves the player. */
export function PanelList({ items, empty }: { items: readonly PanelItem[]; empty?: string }) {
  if (items.length === 0 && empty !== undefined) {
    return <p className="px-2 py-3 text-meta text-fg-3">{empty}</p>;
  }
  return (
    <ul className="grid gap-0.5">
      {items.map((item) => (
        <li key={item.key}>
          <PanelRow item={item} />
        </li>
      ))}
    </ul>
  );
}

const rowClass = (item: PanelItem) =>
  cn(
    "grid w-full grid-cols-[112px_minmax(0,1fr)] items-center gap-3 rounded-md p-2 text-left",
    "transition-colors duration-(--t-fast) fine:hover:bg-hover coarse:min-h-tap",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    item.current && "bg-hover shadow-[inset_0_0_0_1px_var(--line-2)]",
    item.ghost && "opacity-75",
  );

function PanelRow({ item }: { item: PanelItem }) {
  const body = (
    <>
      <Artwork subject={item.subject} noTitle className="rounded-sm" />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-label">{item.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-caption font-normal text-fg-3">
          {item.badge === "rec" ? (
            <Badge tone="rec">{m.status_rec()}</Badge>
          ) : item.badge === "sched" ? (
            <Badge tone="sched">{m.status_scheduled()}</Badge>
          ) : null}
          <span className="truncate">{item.meta}</span>
        </span>
        {item.progress === undefined ? null : (
          <span className="mt-1.5 block h-0.75 overflow-hidden rounded-xs bg-line-2">
            <span
              className={cn("block h-full", item.progress.tone === "live" ? "bg-live" : "bg-brand")}
              style={{ width: `${Math.round(item.progress.value * 100)}%` }}
            />
          </span>
        )}
      </span>
    </>
  );
  if (item.link) {
    return (
      <Link
        {...item.link}
        replace
        className={rowClass(item)}
        aria-current={item.current ? "true" : undefined}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={rowClass(item)}
      aria-current={item.current ? "true" : undefined}
      onClick={item.onSelect}
    >
      {body}
    </button>
  );
}

/** Details: what plays, why, the tracks, conversion and capture health, plus recording controls. */
export function DetailsList({
  rows,
  recording,
}: {
  rows: readonly DetailRow[];
  /** For a running recording: "Recording until 20:30", Extend +30 min, Stop recording. */
  recording?: {
    readonly until: string;
    readonly onExtend: () => void;
    readonly onStop: () => void;
    readonly busy: boolean;
  };
}) {
  return (
    <div className="grid">
      {recording === undefined ? null : (
        <div className="flex flex-wrap gap-2 px-2.5 pt-1.5 pb-3">
          <p className="w-full text-meta text-fg-2">{recording.until}</p>
          <Button
            size="sm"
            variant="secondary"
            icon={<Icon icon={AddIcon} size={16} />}
            onClick={recording.onExtend}
            disabled={recording.busy}
          >
            {m.player_extend({ minutes: extendStepMinutes })}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Icon icon={CloseIcon} size={16} />}
            onClick={recording.onStop}
            disabled={recording.busy}
          >
            {m.guide_stop_recording()}
          </Button>
        </div>
      )}
      <dl className="grid gap-0.5 p-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 p-2.5 text-[13.5px]">
            <dt className="flex-none text-fg-3">{row.label}</dt>
            {/* A long value (a source's name, a codec string) wraps inside the panel. */}
            <dd
              className={cn(
                "min-w-0 text-right font-semibold wrap-anywhere",
                row.warn && "text-warn-fg",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The close button in the panel's tab row. */
export function PanelClose({ onClose }: { onClose: () => void }) {
  return (
    <IconButton label={m.player_panel_close()} size="sm" className="ml-auto mb-1" onClick={onClose}>
      <Icon icon={CloseIcon} size={16} />
    </IconButton>
  );
}
