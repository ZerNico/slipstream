import { m } from "@slipstream/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { QueryKey } from "../../../api/keys.ts";
import { useToast } from "../../../ui/toast.ts";

/** How long a page waits after the last change before saving, ms (the web's delay). */
export const autosaveDelay = 600;

/**
 * Settings save themselves, as on the web and in a phone's own settings: every change shows at
 * once, and the latest value is saved shortly after the last change (a burst of stepper presses
 * is one save). A save puts the server's answer in the cache and says "Saved"; a failed one says
 * "Not saved." and goes back to what the server has. Leaving the page saves what is pending.
 */
export const useAutosave = <T>(
  server: T | undefined,
  queryKey: QueryKey,
  save: (value: T) => Promise<T>,
): { readonly value: T | undefined; readonly change: (next: T) => void } => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<T | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<T | undefined>(undefined);
  const send = useRef<(value: T) => void>(() => undefined);

  // The save as of the latest render, for the timer and for leaving the page.
  useEffect(() => {
    send.current = (value: T) => {
      save(value)
        .then((saved) => {
          queryClient.setQueryData(queryKey, saved);
          // A change made while saving keeps its own draft until its own save lands.
          if (latest.current === value) setDraft(undefined);
          toast({ text: m.settings_saved() });
        })
        .catch(() => {
          if (latest.current === value) setDraft(undefined);
          toast({ text: m.state_not_saved() });
        });
    };
  });

  useEffect(
    () => () => {
      // Leaving within the delay still saves the last change.
      if (timer.current === undefined) return;
      clearTimeout(timer.current);
      const pending = latest.current;
      if (pending !== undefined) send.current(pending);
    },
    [],
  );

  const change = (next: T) => {
    setDraft(next);
    latest.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      send.current(next);
    }, autosaveDelay);
  };

  return { value: draft ?? server, change };
};
