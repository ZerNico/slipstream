import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { storageKeys } from "~/storage-keys.ts";
import { matchesMedia, media } from "~/ui/use-media-query.ts";

/** A corner of the window the mini player rests in. */
export type MiniCorner = "br" | "bl" | "tr" | "tl";

/** How wide the card may be, px. */
export const MINI_MIN_WIDTH = 280;
export const MINI_MAX_WIDTH = 720;
/** How wide the card is until it is resized, px. */
const MINI_DEFAULT_WIDTH = 360;

const STORAGE_KEY = storageKeys.miniPlayer;
/** How far the pointer moves before a press on the card counts as a drag, px. */
const DRAG_SLOP = 5;

/** The corner nearest to a point: the card snaps there when it is let go. */
export const nearestCorner = (
  x: number,
  y: number,
  viewport: { readonly width: number; readonly height: number },
): MiniCorner =>
  `${y < viewport.height / 2 ? "t" : "b"}${x < viewport.width / 2 ? "l" : "r"}` as MiniCorner;

/** A width kept between the card's limits and the window. */
export const clampWidth = (width: number, viewportWidth: number): number =>
  Math.round(Math.min(MINI_MAX_WIDTH, viewportWidth - 40, Math.max(MINI_MIN_WIDTH, width)));

interface Placement {
  readonly corner: MiniCorner;
  readonly width: number;
}

const corners: readonly MiniCorner[] = ["br", "bl", "tr", "tl"];

/** The placement this browser remembered; the default when there is none or storage is off. */
const readPlacement = (): Placement => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (typeof raw === "object" && raw !== null) {
      const { corner, width } = raw as { corner?: unknown; width?: unknown };
      return {
        corner: corners.find((candidate) => candidate === corner) ?? "br",
        width: typeof width === "number" ? width : MINI_DEFAULT_WIDTH,
      };
    }
  } catch {
    // Storage blocked or unreadable: the default placement.
  }
  return { corner: "br", width: MINI_DEFAULT_WIDTH };
};

const writePlacement = (placement: Placement) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(placement));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
};

/**
 * Where the desktop mini player sits and how wide it is: dragged anywhere and let go, it slides
 * into the nearest corner; the handle at its inner corner resizes it. Both are remembered in this
 * browser. A press that does not move is a click as before (open, play, close).
 */
export const useMiniPlacement = () => {
  const [placement, setPlacement] = useState(readPlacement);
  const [drag, setDrag] = useState<{ readonly dx: number; readonly dy: number } | undefined>(
    undefined,
  );
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  const update = (next: Placement) => {
    setPlacement(next);
    writePlacement(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The phone's bar stays where it is; only the desktop card moves.
    if (event.button !== 0 || event.pointerType === "touch" || !matchesMedia(media.tablet)) return;
    if ((event.target as HTMLElement).closest("[data-mini-resize]")) return;
    start.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (!origin.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!origin.moved) {
      origin.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDrag({ dx, dy });
  };
  // A drag the browser took over (a gesture, the window losing focus): back to the corner.
  const onPointerCancel = () => {
    start.current = undefined;
    setDrag(undefined);
  };
  const onPointerUp = () => {
    const origin = start.current;
    start.current = undefined;
    if (!origin?.moved || !card) return;
    suppressClick.current = true;
    const from = card.getBoundingClientRect();
    // Snap now, then glide from where it was let go into the corner (FLIP).
    flushSync(() => {
      setDrag(undefined);
      update({
        ...placement,
        corner: nearestCorner(from.left + from.width / 2, from.top + from.height / 2, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      });
    });
    const to = card.getBoundingClientRect();
    card.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  };
  // The click that ends a drag opens nothing.
  const onClickCapture = (event: ReactMouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onResizeDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = placement.width;
    // The handle is on the inner side: dragging it away from the docked edge widens the card.
    const sign = placement.corner.endsWith("r") ? -1 : 1;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      setPlacement((current) => ({
        ...current,
        width: clampWidth(startWidth + sign * (moveEvent.clientX - startX), window.innerWidth),
      }));
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setPlacement((current) => {
        writePlacement(current);
        return current;
      });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  // The window may narrow after the width was set: the card never reaches past its edge.
  const style = {
    "--mini-w": `min(${clampWidth(placement.width, typeof window === "undefined" ? 1280 : window.innerWidth)}px, 100vw - 40px)`,
    ...(drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}),
  } as CSSProperties;

  return {
    setCard,
    corner: placement.corner,
    dragging: drag !== undefined,
    style,
    cardProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    onResizeDown,
  };
};
