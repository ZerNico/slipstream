import { useSyncExternalStore } from "react";

/** Media queries the layout decides by (SPEC §2.1). CSS uses the same conditions. */
export const media = {
  /** The side drawer replaces the bottom sheet, the rail or top bar replaces the tab bar. */
  tablet: "(min-width: 768px)",
  /** `sm` dialogs are centred from here; below they are bottom sheets. */
  phablet: "(min-width: 600px)",
  desktop: "(min-width: 1100px)",
  /** Phones turned sideways at any width. */
  shortLandscape: "(max-height: 520px) and (orientation: landscape)",
  /** Menus render as sheets (SPEC §2.4). */
  menuAsSheet: "(pointer: coarse) and (max-width: 767px)",
  finePointer: "(hover: hover) and (pointer: fine)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
} as const;

type Subscribe = (notify: () => void) => () => void;

/** One subscribe function per query, so React does not resubscribe on every render. */
const subscribers = new Map<string, Subscribe>();

const subscribeTo = (query: string): Subscribe => {
  const known = subscribers.get(query);
  if (known) return known;
  const subscribe: Subscribe = (notify) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const list = window.matchMedia(query);
    list.addEventListener("change", notify);
    return () => list.removeEventListener("change", notify);
  };
  subscribers.set(query, subscribe);
  return subscribe;
};

/** Whether a media query matches now, without subscribing (event handlers, effects). */
export const matchesMedia = (query: string): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(query).matches;

/**
 * Whether a media query matches, re-rendering when it changes (a rotated phone, a resized
 * window). Layout still comes from CSS; this only picks behaviour such as the swipe direction.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeTo(query),
    () => matchesMedia(query),
    () => false,
  );
}
