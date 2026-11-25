import { createContext, use, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * What the mini player plays: what you left playing on this page. A recording (`id` is its
 * id) carries where you were; a live channel that is not being recorded (`id` is the channel)
 * picks up at live.
 */
export type MiniPlayerItem =
  | {
      readonly kind: "recording";
      /** The recording's id; screens that show the same recording hide the mini player. */
      readonly id: string;
      /** The programme's own title ("Qualifying", never "Qualifying · GP Katar" on phones). */
      readonly title: string;
      /** Still recording: `resumeT` is wall-clock ms; finished: position ms. */
      readonly live: boolean;
      /** Where the mini player starts and the full player continues. */
      readonly resumeT: number;
    }
  | {
      readonly kind: "channel";
      /** The channel's id. */
      readonly id: string;
      /** What is on, or the channel's name. */
      readonly title: string;
    };

const listeners = new Set<() => void>();
let current: MiniPlayerItem | null = null;

/**
 * Hands what the player was playing to the mini player when the player closes while it plays,
 * or clears it with `null` (closed while paused, or the mini player's close button). Kept for
 * this page only: after a reload there is no mini player.
 */
export const setMiniPlayerItem = (item: MiniPlayerItem | null): void => {
  current = item;
  for (const notify of listeners) notify();
};

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

/** What the mini player plays, updating when it changes. */
export const useMiniPlayerItem = (): MiniPlayerItem | null =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

/** Recording ids the current screen shows itself, so the mini player stays away. */
export const SuppressContext = createContext<(ids: readonly string[]) => () => void>(
  () => () => {},
);

/**
 * Hides the mini player while this screen shows any of `ids` (Home: every hero tab; the
 * recording detail: its recording). Registered before paint, so the reserved space is decided
 * with the route's first render and never toggles inside the page (SPEC §2.2, decision r3 #2).
 */
export function useSuppressMiniPlayer(ids: readonly string[]): void {
  const register = use(SuppressContext);
  const key = ids.join("|");
  useLayoutEffect(() => register(key === "" ? [] : key.split("|")), [register, key]);
}
