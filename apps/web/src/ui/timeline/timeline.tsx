import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { formatBehind, formatClock, formatPosition } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { cn } from "~/ui/utils.ts";
import {
  type HoverInfo,
  hoverAt,
  layoutTimeline,
  withOverrun,
  type PlacedLabel,
  placeLabels,
  seekForKey,
  seekTimeAt,
  type TimelineData,
} from "./geometry.ts";

/** What the Timeline component shows and how it seeks. */
export interface TimelineProps {
  readonly data: TimelineData;
  /** `full` has label rows and bands; `compact` (sheets, choice dialog) has a caption row instead. */
  readonly variant?: "full" | "compact";
  /** Positions as time into a finished recording (`0:00` to the length) instead of wall clock. */
  readonly relative?: boolean;
  /** The bar is a slider (player only): seeking by pointer and keys calls `onSeek`. */
  readonly onSeek?: (time: number) => void;
  /** The start of the programme, where Home jumps (defaults to the start of what was captured). */
  readonly programmeStart?: number;
  /** The slider's name ("Position in Qualifying"). */
  readonly label?: string;
  /** A line 8 px below the bottom labels ("Started 42 min ago · 48 min left"). */
  readonly caption?: ReactNode;
  readonly className?: string;
}

const at = (left: number): CSSProperties => ({ left: `${left}%` });
const span = (segment: { left: number; width: number }): CSSProperties => ({
  left: `${segment.left}%`,
  width: `${segment.width}%`,
});

/**
 * The timeline (SPEC §5): one component for the hero, sheets, the choice dialog, the player, the
 * recording detail and the mini player. Every row is reserved; labels that would collide hide by
 * visibility; hover only scales the track and moves the absolutely positioned marker and tooltip.
 * With `onSeek` the whole bar is a slider: drag with pointer capture, ←/→ 10 s, Shift or PgUp/PgDn
 * 60 s, Home to the programme start, End to live.
 */
export function Timeline({
  data: given,
  variant = "full",
  relative = false,
  onSeek,
  programmeStart,
  label,
  caption,
  className,
}: TimelineProps) {
  const data = withOverrun(given);
  const layout = layoutTimeline(data);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const width = useWidth(trackRef);
  const labels = placeLabels(layout, width);
  const [hover, setHover] = useState<{ fraction: number; info: HoverInfo } | null>(null);
  const [dragging, setDragging] = useState(false);
  const interactive = onSeek !== undefined;
  const showBands = variant === "full" && layout.bands.length > 0;

  const time = (value: number) =>
    relative ? formatPosition(value - data.start) : formatClock(value);
  const fractionAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  };
  const seekTo = (clientX: number) => {
    const target = seekTimeAt(data, fractionAt(clientX));
    if (target !== undefined) onSeek?.(target);
  };
  const track = (clientX: number) => {
    const fraction = Math.min(1, Math.max(0, fractionAt(clientX)));
    setHover({ fraction, info: hoverAt(data, fraction) });
  };

  const sliderProps = interactive
    ? {
        role: "slider",
        tabIndex: 0,
        "aria-label": label ?? m.timeline_position_label(),
        "aria-valuemin": 0,
        "aria-valuemax": Math.round((data.end - data.start) / 1000),
        "aria-valuenow": Math.round(((data.playhead ?? data.start) - data.start) / 1000),
        "aria-valuetext": valueText(data, relative),
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          const next = seekForKey(
            data,
            data.playhead ?? data.start,
            event.key,
            event.shiftKey,
            programmeStart,
          );
          if (next === undefined) return;
          event.preventDefault();
          onSeek(next);
        },
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          track(event.clientX);
          seekTo(event.clientX);
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
          // On touch the tooltip shows only while dragging, so it never sticks after a tap.
          if (event.pointerType !== "mouse" && !dragging) return;
          track(event.clientX);
          if (dragging) seekTo(event.clientX);
        },
        onPointerUp: () => setDragging(false),
        onPointerCancel: () => setDragging(false),
        onPointerLeave: () => {
          if (!dragging) setHover(null);
        },
      }
    : {};

  return (
    <div
      className={cn("tl", className)}
      data-timeline=""
      data-variant={variant}
      data-bands={showBands ? "" : undefined}
      data-interactive={interactive ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      {...sliderProps}
    >
      {showBands ? (
        <div className="tl-bands" aria-hidden="true">
          {layout.bands.map((band) => (
            <span
              key={`${band.left}-${band.title}`}
              className="tl-band"
              data-current={band.current ? "" : undefined}
              style={span(band)}
              title={band.title}
            >
              <span className="tl-band-label">{band.title}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div ref={trackRef} className="tl-track">
        {/* Only the fills thicken on hover; the dots and ticks above them keep their shape. */}
        <div className="tl-fill">
          {layout.aired ? <div className="tl-aired" style={span(layout.aired)} /> : null}
          {layout.upcoming ? <div className="tl-upcoming" style={span(layout.upcoming)} /> : null}
          {layout.captured ? <div className="tl-captured" style={span(layout.captured)} /> : null}
          {layout.played ? <div className="tl-played" style={span(layout.played)} /> : null}
          {layout.behind ? <div className="tl-behind" style={span(layout.behind)} /> : null}
          {layout.gaps.map((gap) => (
            <div key={gap.left} className="tl-hole" style={span(gap)} />
          ))}
        </div>
        {layout.marks.map((mark) => (
          <div key={mark} className="tl-tick" style={at(mark)} />
        ))}
        {layout.live === undefined ? null : <div className="tl-edge" style={at(layout.live)} />}
        {layout.now === undefined ? null : (
          <div className="tl-edge" data-still="" style={at(layout.now)} />
        )}
        {layout.playhead === undefined ? null : (
          <div className="tl-knob" style={at(layout.playhead)} />
        )}
        {interactive ? <div className="tl-hover" style={at((hover?.fraction ?? 0) * 100)} /> : null}
      </div>
      {/* At live the read-out already says so; the label marks the edge only when behind. */}
      <Label
        place={
          data.live === undefined ||
          (data.playhead !== undefined && data.live - data.playhead < 15_000)
            ? undefined
            : labels.live
        }
        className="tl-label-top tl-label-live"
      >
        {data.live === undefined ? null : m.timeline_live_label({ clock: formatClock(data.live) })}
      </Label>
      <Label place={labels.now} className="tl-label-top tl-label-now">
        {data.now === undefined ? null : m.timeline_now_label({ clock: formatClock(data.now) })}
      </Label>
      <Label place={labels.here} className="tl-label-top tl-label-here">
        {data.playhead === undefined ? null : time(data.playhead)}
      </Label>
      <Label place={labels.start} className="tl-label-bottom">
        {relative ? formatPosition(0) : formatClock(data.start)}
      </Label>
      <Label place={labels.end} className="tl-label-bottom">
        {relative ? formatPosition(data.end - data.start) : formatClock(data.end)}
      </Label>
      {interactive ? (
        <div
          className="tl-tip"
          data-future={hover?.info.kind === "future" ? "" : undefined}
          style={at((hover?.fraction ?? 0) * 100)}
          aria-hidden="true"
        >
          {hover ? tipText(hover.info, relative ? data.start : undefined) : null}
        </div>
      ) : null}
      {caption === undefined ? null : <p className="tl-caption">{caption}</p>}
    </div>
  );
}

function Label({
  place,
  className,
  children,
}: {
  place: PlacedLabel | undefined;
  className: string;
  children: ReactNode;
}) {
  if (place === undefined) return null;
  return (
    <span
      className={cn("tl-label", className)}
      data-align={place.align}
      data-hidden={place.visible ? undefined : ""}
      style={at(place.left)}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/** The tooltip: "18:30 · −12:00 · Qualifying", "18:42 · Live · Qualifying", "Not aired yet · 19:28". */
const tipText = (info: HoverInfo, relativeTo: number | undefined): string => {
  const clock =
    relativeTo === undefined ? formatClock(info.time) : formatPosition(info.time - relativeTo);
  if (info.kind === "future") return m.timeline_tip_future({ clock });
  const parts = [
    clock,
    info.kind === "live"
      ? m.player_badge_live()
      : info.behindMs === undefined
        ? null
        : formatBehind(info.behindMs),
    info.band ?? null,
  ];
  return parts.filter((part): part is string => part !== null).join(" · ");
};

/** The slider's value in words: "18:11, −31:30 behind live" or "Live, 18:42" (SPEC §10). */
const valueText = (data: TimelineData, relative: boolean): string => {
  const position = data.playhead ?? data.start;
  if (relative) {
    return m.timeline_value_relative({
      position: formatPosition(position - data.start),
      length: formatPosition(data.end - data.start),
    });
  }
  if (data.live !== undefined && data.live - position <= 1000) {
    return m.timeline_value_live({ clock: formatClock(data.live) });
  }
  return data.live === undefined
    ? formatClock(position)
    : m.timeline_value_behind({
        clock: formatClock(position),
        behind: formatBehind(data.live - position),
      });
};

/** The bar's width in px, kept current as the layout changes. */
function useWidth(ref: { readonly current: HTMLElement | null }): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : undefined);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
