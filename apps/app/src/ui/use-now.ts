import { useEffect, useState } from "react";

/** The current time in epoch ms, refreshed every `everyMs` (clocks, now lines, countdowns). */
export const useNow = (everyMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
};
