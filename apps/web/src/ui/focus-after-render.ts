import type { RefObject } from "react";

/**
 * Moves focus to `target` once the state change that brings it back has been drawn: after a
 * confirm step closes, or a failed attempt clears and re-enables its field. Called right after
 * the state change, when the element may not exist (or still be disabled) yet.
 */
export const focusAfterRender = (target: RefObject<HTMLElement | null>): void => {
  window.requestAnimationFrame(() => target.current?.focus());
};
