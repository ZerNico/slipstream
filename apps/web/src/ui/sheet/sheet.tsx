import { Drawer } from "@base-ui/react/drawer";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CloseIcon } from "~/ui/icons.ts";
import { IconButton } from "~/ui/primitives/button.tsx";
import { openedFromKeyboard } from "~/ui/input-modality.ts";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";
import { findHalfAnchor, snapPointsFor } from "./snap.ts";

/** What a sheet shows and how it closes. */
export interface SheetProps {
  readonly open: boolean;
  /** Called with `false` on a drag down, the backdrop, Esc, the close button. */
  readonly onOpenChange: (open: boolean) => void;
  /** The sheet's accessible name (also its visible title in the header row when `context` is unset). */
  readonly label: string;
  /** The header row's text: on the side drawer, and on bottom sheets without artwork. */
  readonly context?: ReactNode;
  /** Artwork flush at the top edge (phones) or inset under the header (side drawer). */
  readonly art?: ReactNode;
  /** The pinned footer: one primary, every control `lg`. */
  readonly footer?: ReactNode;
  /**
   * Size the half snap to the content: the element marked `data-half` (or the timeline block
   * right after it) stays fully visible above the footer. Off: the sheet opens at full height.
   */
  readonly halfSnap?: boolean;
  /** Where keyboard users land when the sheet opens; touch and mouse land on the sheet itself. */
  readonly keyboardFocus?: RefObject<HTMLElement | null>;
  /** Where focus goes when the sheet closes; the opener by default. */
  readonly returnFocus?: RefObject<HTMLElement | null>;
  /** Keeps the sheet dark whatever the theme (sheets opened from the player). */
  readonly cine?: boolean;
  /** Always a bottom sheet, even from 768 px (menus rendered as sheets are phone-only anyway). */
  readonly bottomOnly?: boolean;
  /** The content names itself: on bottom sheets the header row is for assistive tech only. */
  readonly hideHeader?: boolean;
  readonly children: ReactNode;
}

/**
 * `open`, a frame late when it opens: Base UI draws a popup that mounts already open without its
 * enter motion (no reload should fly in), and a sheet opened from the URL mounts open, so it
 * would pop in. Closing follows at once.
 */
const useEnterFrame = (open: boolean): boolean => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return open && shown;
};

/**
 * The one sheet behaviour in the app (SPEC §2.4, §4, §8.3). Under 768 px a bottom sheet: grab
 * handle, drag down to dismiss from the handle, the header or the content at scroll top, velocity
 * snapping between half and full, rubber band past the top, the footer pinned to the screen. From
 * 768 px a side drawer with a header row and a close button (swipe right to dismiss on touch).
 * Modal: focus trap, background inert, scroll lock, Esc, focus returns to the opener.
 */
export function Sheet({
  open,
  onOpenChange,
  label,
  context,
  art,
  footer,
  halfSnap = true,
  keyboardFocus,
  returnFocus,
  cine = false,
  bottomOnly = false,
  hideHeader = false,
  children,
}: SheetProps) {
  const wide = useMediaQuery(media.tablet);
  const side = wide && !bottomOnly;
  // State, not a ref: Base UI mounts the popup in a portal after this component's first commit,
  // and the snap measurement has to run again once it exists.
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const shown = useEnterFrame(open);
  const snap = useHalfSnap({ open: shown, enabled: halfSnap && !side, popup, footerRef });

  return (
    <Drawer.Root
      open={shown}
      onOpenChange={onOpenChange}
      swipeDirection={side ? "right" : "down"}
      // The snap point is controlled from the first render; the points arrive once measured.
      snapPoint={snap.active}
      onSnapPointChange={snap.setActive}
      {...(snap.points ? { snapPoints: [...snap.points] } : {})}
    >
      <Drawer.Portal>
        <Drawer.Backdrop
          className="sheet-backdrop"
          data-snap-points={snap.points ? "" : undefined}
        />
        <Drawer.Viewport
          className="sheet-viewport"
          data-side={side ? "right" : "bottom"}
          data-overlay-root=""
        >
          <Drawer.Popup
            ref={setPopup}
            className="sheet"
            data-side={side ? "right" : "bottom"}
            data-has-art={art === undefined ? undefined : ""}
            data-has-footer={footer === undefined ? undefined : ""}
            data-snap-points={snap.points ? "" : undefined}
            data-header={hideHeader ? "hidden" : undefined}
            data-surface={cine ? "cine" : undefined}
            initialFocus={(type) =>
              openedFromKeyboard(type) ? (keyboardFocus?.current ?? true) : popup
            }
            {...(returnFocus ? { finalFocus: returnFocus } : {})}
          >
            {side ? null : <div className="sheet-grab" aria-hidden="true" />}
            <div className="sheet-header">
              <Drawer.Title className="sheet-context">{context ?? label}</Drawer.Title>
              <span className="sheet-close">
                <Drawer.Close
                  render={
                    <IconButton label={m.action_close()} tooltip={false}>
                      <Icon icon={CloseIcon} />
                    </IconButton>
                  }
                />
              </span>
            </div>
            <Drawer.Content className="sheet-body">
              {art === undefined ? null : <div className="sheet-art">{art}</div>}
              {children}
            </Drawer.Content>
            {footer === undefined ? null : (
              <div ref={footerRef} className="sheet-footer">
                {footer}
              </div>
            )}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** A snap point as Base UI takes it: a visible height in px. */
type SnapPoint = string | number;

/**
 * Measures the half snap while the sheet is open and keeps it in step with the content (data
 * arriving, a rotated phone). Opens at half when there is one (decision r1 #3); a re-measure
 * keeps whichever position the reader chose.
 */
function useHalfSnap({
  open,
  enabled,
  popup,
  footerRef,
}: {
  open: boolean;
  enabled: boolean;
  popup: HTMLDivElement | null;
  footerRef: RefObject<HTMLDivElement | null>;
}) {
  const [points, setPoints] = useState<readonly string[] | undefined>(undefined);
  /** 0 is the half snap, 1 the full height. */
  const [index, setIndex] = useState(0);
  // Every opening starts at the half snap again.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIndex(0);
  }

  useLayoutEffect(() => {
    if (!open || !enabled || !popup) return;
    const measure = () => {
      const anchor = findHalfAnchor(popup);
      const next = anchor
        ? snapPointsFor({
            sheetHeight: popup.offsetHeight,
            anchorBottom: anchor.getBoundingClientRect().bottom - popup.getBoundingClientRect().top,
            footerHeight: footerRef.current?.offsetHeight ?? 0,
            viewportHeight: window.innerHeight,
          })
        : undefined;
      setPoints((previous) => (sameSnaps(previous, next) ? previous : next));
    };
    // Anything above the half anchor can change height after opening (art, badges, the footer
    // arriving with the data), so every block of the body and the footer is watched, and
    // blocks that mount later are picked up too.
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(popup);
      const body = popup.querySelector(".sheet-body");
      for (const block of body?.children ?? []) sizes.observe(block);
      if (footerRef.current) sizes.observe(footerRef.current);
    };
    const mounts = new MutationObserver(() => {
      watch();
      measure();
    });
    mounts.observe(popup, { childList: true, subtree: true });
    watch();
    measure();
    window.addEventListener("resize", measure);
    return () => {
      sizes.disconnect();
      mounts.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, enabled, popup, footerRef]);

  const active = open && enabled ? points : undefined;
  return {
    points: active,
    active: active ? (active[index] ?? null) : null,
    setActive: (point: SnapPoint | null) => {
      const found = active?.indexOf(String(point)) ?? -1;
      setIndex(found === -1 ? 1 : found);
    },
  };
}

const sameSnaps = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.join() === b.join());
