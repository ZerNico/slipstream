import { useEffect, useState } from "react";

/**
 * `value` once it has stopped changing for `delayMs`, so typing asks the server once per pause
 * instead of once per key.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
