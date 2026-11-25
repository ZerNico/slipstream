import {
  type NavigateOptions,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import {
  closeMode,
  openMode,
  type Overlay,
  type OverlayKind,
  type OverlayName,
  type OverlaySearch,
  type OverlayTarget,
  readOverlay,
  sameOverlay,
  withOverlay,
} from "./overlay-state.ts";

/** The history-state flag that marks an entry this app pushed for an overlay. */
const pushedFlag = "ssOverlay";

const pushedHere = (state: unknown): boolean =>
  typeof state === "object" && state !== null && pushedFlag in state && state[pushedFlag] === true;

/** What the overlay hook gives a component. */
export interface OverlayControls {
  /** The overlay in the URL, or null. */
  readonly current: Overlay | null;
  /** Whether `overlay` is the one in the URL. */
  readonly isOpen: (overlay: OverlayTarget) => boolean;
  /** Opens an overlay: pushes one entry, or replaces the one an open overlay holds. */
  readonly open: (overlay: OverlayTarget) => void;
  /**
   * Closes the open overlay: back to the page under it, never out of the app. Resolves once the
   * URL no longer holds the overlay, so a follow-up navigation is not undone by the Back.
   */
  readonly close: () => Promise<void>;
  /**
   * Navigates from inside an overlay to another page, replacing the overlay's entry so Back never
   * reopens it.
   */
  readonly leaveTo: (target: NavigateOptions) => void;
}

/**
 * The URL-addressable overlay state (SPEC §11). Sheets, dialogs and menus-as-sheets read and
 * write it, so Back, the back gesture, Esc, the backdrop and a drag all close the same way.
 */
export function useOverlay(): OverlayControls {
  const navigate = useNavigate();
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });
  const current = readOverlay(location.search);

  // Callbacks read the router's live location, not this render's: a pick made right after a
  // close must see the page under the overlay, not the overlay it just left.
  const live = () => {
    const now = router.state.location;
    return { open: readOverlay(now.search), pushed: pushedHere(now.state) };
  };

  return {
    current,
    isOpen: (overlay) => sameOverlay(current, overlay),
    open: (overlay) => {
      const { open, pushed } = live();
      if (sameOverlay(open, overlay)) return;
      const mode = openMode(open);
      // A replacing overlay inherits whether its entry was pushed here.
      const flag = mode === "push" ? true : pushed;
      void navigate({
        to: ".",
        search: (prev: OverlaySearch) => withOverlay(prev, overlay),
        replace: mode === "replace",
        state: (prev) => ({ ...prev, [pushedFlag]: flag }) as typeof prev,
        resetScroll: false,
      });
    },
    close: async () => {
      const { open, pushed } = live();
      if (open === null) return;
      if (closeMode(pushed) === "back") {
        await new Promise<void>((resolve) => {
          const stop = router.subscribe("onResolved", () => {
            if (readOverlay(router.state.location.search) !== null) return;
            stop();
            resolve();
          });
          router.history.back();
        });
        return;
      }
      await navigate({
        to: ".",
        search: (prev: OverlaySearch) => withOverlay(prev, null),
        replace: true,
        resetScroll: false,
      });
    },
    leaveTo: (target) => {
      const { open, pushed } = live();
      void navigate({ ...target, replace: open !== null && pushed });
    },
  };
}

/**
 * Keeps the last overlay this component showed while its closing animation runs: the URL has
 * already dropped it, but the sheet still needs its content until it has slid away.
 */
export function useLatchedOverlay(match: (overlay: Overlay | null) => Overlay | null): {
  readonly open: boolean;
  readonly overlay: Overlay | null;
} {
  const { current } = useOverlay();
  const matched = match(current);
  const [latched, setLatched] = useState<Overlay | null>(matched);
  if (matched !== null && !sameOverlay(matched, latched)) setLatched(matched);
  return { open: matched !== null, overlay: matched ?? latched };
}

/** What a sheet or dialog bound to the URL needs: its open state, its overlay, how to close. */
export interface OverlayBinding {
  readonly open: boolean;
  /** The overlay it shows; kept during the closing animation after the URL dropped it. */
  readonly overlay: Overlay | null;
  /** Hand to the sheet or dialog: closing goes back through the URL. */
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Binds a sheet or dialog to one overlay name (`useOverlayBinding("sheet", "prog")`), so the
 * URL decides whether it is open and every way of closing it goes back through history.
 */
export function useOverlayBinding<K extends OverlayKind>(
  kind: K,
  name?: OverlayName<K>,
): OverlayBinding {
  const controls = useOverlay();
  const { open, overlay } = useLatchedOverlay((current) =>
    current !== null && current.kind === kind && (name === undefined || current.name === name)
      ? current
      : null,
  );
  return {
    open,
    overlay,
    onOpenChange: (next) => {
      if (!next && open) void controls.close();
    },
  };
}
