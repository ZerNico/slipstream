import { type FitMode, fitAfterPinch } from "@slipstream/domain";
import { type RefObject, useEffect, useRef } from "react";

/** How far apart two touches are, or undefined without two. */
const spread = (touches: TouchList): number | undefined => {
  const a = touches[0];
  const b = touches[1];
  return a === undefined || b === undefined
    ? undefined
    : Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
};

/**
 * On a touch screen, two fingers spread on the picture fill the screen and two fingers closed
 * fit the whole picture, as on the phone app. The page itself then never zooms there (the
 * element takes `touch-action: pan-x pan-y`).
 */
export function usePinchFit(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  fit: FitMode,
  onFit: (fit: FitMode) => void,
): void {
  const latest = useRef({ fit, onFit });
  useEffect(() => {
    latest.current = { fit, onFit };
  });
  useEffect(() => {
    const element = ref.current;
    if (!enabled || element === null) return;
    let start: number | undefined;
    let last: number | undefined;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      start = spread(event.touches);
      last = start;
    };
    const onMove = (event: TouchEvent) => {
      if (start !== undefined && event.touches.length === 2) last = spread(event.touches);
    };
    const onEnd = (event: TouchEvent) => {
      if (start === undefined || event.touches.length >= 2) return;
      const scale = last === undefined || start === 0 ? 1 : last / start;
      start = undefined;
      const current = latest.current;
      const next = fitAfterPinch(current.fit, scale);
      if (next !== current.fit) current.onFit(next);
    };
    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: true });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled]);
}
