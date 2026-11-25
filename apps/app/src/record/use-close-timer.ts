import { useCallback, useEffect, useRef } from "react";

/** The record sheet's delayed close, which a step that follows can call off. */
export interface CloseTimer {
  /** Closes after `millis`, replacing a close already pending. */
  readonly closeAfter: (millis: number) => void;
  /** Calls off a pending close. */
  readonly cancel: () => void;
}

/**
 * One pending `onClose` at a time, kept in a ref so a re-render never loses it. Unmounting
 * clears it, so a sheet closed another way never closes the screen behind it later.
 */
export const useCloseTimer = (onClose: () => void): CloseTimer => {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const closeAfter = useCallback(
    (millis: number) => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        onClose();
      }, millis);
    },
    [onClose],
  );
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );
  return { closeAfter, cancel };
};
