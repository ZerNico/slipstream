import { useEffect, useMemo, useState } from "react";

/**
 * `value`, once it has stayed the same for `delayMs`: typing in a search, a draft the preview
 * asks about. Compared by its JSON, so a value rebuilt on every render still settles.
 */
export const useSettled = <T>(value: T, delayMs: number): T => {
  const json = JSON.stringify(value);
  const [settled, setSettled] = useState(json);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(json), delayMs);
    return () => clearTimeout(timer);
  }, [json, delayMs]);
  return useMemo(() => JSON.parse(settled) as T, [settled]);
};
