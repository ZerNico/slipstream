import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";

/** How long the chrome stays after the last pointer or key input while playing, ms. */
export const idleAfterMs = 3000;

/**
 * The player's three layouts (SPEC §2.1, §7.1): the overlay (desktop, tablet, landscape),
 * phone portrait (picture on top, controls stacked below) and short landscape (overlay,
 * compact, no bands). Decided by the same media conditions the CSS would use.
 */
export type PlayerLayout = "overlay" | "portrait" | "short";

/** The player layout for the viewport, following rotation and resizing. */
export function usePlayerLayout(): PlayerLayout {
  const portrait = useMediaQuery("(max-width: 767px) and (orientation: portrait)");
  const short = useMediaQuery(media.shortLandscape);
  return portrait ? "portrait" : short ? "short" : "overlay";
}

/**
 * Whether the chrome has gone idle: after {@link idleAfterMs} of no pointer or key input while
 * playing, unless a menu is open or the pointer rests on the chrome or the panel. Any input
 * wakes it. Phone portrait never idles (the controls sit below the picture).
 */
export function useIdle(input: {
  readonly root: RefObject<HTMLElement | null>;
  readonly playing: boolean;
  /** A menu is open, or the layout never idles. */
  readonly hold: boolean;
}): {
  readonly idle: boolean;
  /** The pointer came to rest on the chrome or the panel (true) or left it (false). */
  readonly setResting: (resting: boolean) => void;
} {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // The pointer rests on the chrome or the panel: those set this while hovered.
  const resting = useRef(false);
  const state = useRef(input);
  useEffect(() => {
    state.current = input;
  });

  const wake = () => {
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const { playing, hold } = state.current;
      if (playing && !hold && !resting.current) setIdle(true);
    }, idleAfterMs);
  };

  const wakeRef = useRef(wake);
  useEffect(() => {
    wakeRef.current = wake;
  });

  useEffect(() => {
    const element = input.root.current;
    if (!element) return;
    const onInput = () => wakeRef.current();
    element.addEventListener("pointermove", onInput);
    element.addEventListener("pointerdown", onInput);
    window.addEventListener("keydown", onInput);
    onInput();
    return () => {
      element.removeEventListener("pointermove", onInput);
      element.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.clearTimeout(timer.current);
    };
  }, [input.root]);

  // Pausing, opening a menu or leaving the overlay layout brings the chrome back at once.
  const awake = !input.playing || input.hold;
  useEffect(() => {
    if (awake) wakeRef.current();
  }, [awake]);

  return {
    idle: idle && !awake,
    setResting: (next) => {
      resting.current = next;
    },
  };
}

/** Whether this document is in full screen, following the browser's own changes (Esc). */
export function useFullscreen(): boolean {
  const [full, setFull] = useState(
    () => typeof document !== "undefined" && document.fullscreenElement !== null,
  );
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  return full;
}

/**
 * Enters or leaves full screen with the Fullscreen API on the player. On a phone it then turns
 * to landscape where the browser allows it; iOS Safari, which has no Fullscreen API for
 * elements, uses the video element's own full screen.
 */
export const toggleFullscreen = async (
  root: HTMLElement | null,
  video: HTMLVideoElement | null,
  options: { readonly rotate?: boolean } = {},
): Promise<void> => {
  if (document.fullscreenElement) {
    try {
      screen.orientation.unlock();
    } catch {
      // Unlocking is best effort.
    }
    await document.exitFullscreen().catch(() => {});
    return;
  }
  if (root && typeof root.requestFullscreen === "function" && document.fullscreenEnabled) {
    try {
      await root.requestFullscreen();
      if (options.rotate) {
        // Not every browser can lock the orientation (Safari can't); a refusal is fine.
        await screen.orientation.lock("landscape").catch(() => {});
      }
    } catch {
      // Refused (no user gesture, or the browser said no): nothing to undo.
    }
    return;
  }
  // iOS Safari has no Fullscreen API for elements, only the video element's own full screen.
  if (
    video &&
    "webkitEnterFullscreen" in video &&
    typeof video.webkitEnterFullscreen === "function"
  ) {
    video.webkitEnterFullscreen();
  }
};

/**
 * Where the panel stops above the read-out row (`--chrome-b`, SPEC §7.1): 12 px above it,
 * measured whenever the panel opens or the viewport changes, so it never covers the read-out.
 */
export function useChromeBottom(
  readRow: RefObject<HTMLElement | null>,
  active: boolean,
): number | undefined {
  const [bottom, setBottom] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const row = readRow.current;
      if (!row || row.offsetParent === null) return;
      setBottom(Math.round(window.innerHeight - row.getBoundingClientRect().top + 12));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [readRow, active]);
  return bottom;
}

/**
 * A short confirmation over the picture ("Volume 60 %", "1.25×", "Live"): shown for 900 ms and
 * announced politely, the one live region the player has (SPEC §10).
 */
export function useOsd(): {
  readonly text: string;
  readonly shown: boolean;
  readonly show: (text: string) => void;
} {
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    text,
    shown,
    show: (next) => {
      setText(next);
      setShown(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShown(false), 900);
    },
  };
}
