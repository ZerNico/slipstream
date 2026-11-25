import { useEffect, useRef, useState } from "react";
import { m } from "@slipstream/i18n";
import { announce } from "~/ui/announce-store.ts";
import { toast } from "~/ui/toast-manager.ts";

/** How long the page waits after the last change before saving, ms. */
export const autosaveDelay = 600;

/**
 * Settings save themselves, like a phone's settings: every change shows at once, and the page
 * saves the latest value shortly after the last change (a burst of stepper presses is one save).
 * A failed save says "Not saved." and goes back to what the server has.
 */
export function useAutosave<T>(
  server: T | undefined,
  save: (
    value: T,
    callbacks: { readonly onSuccess: () => void; readonly onError: () => void },
  ) => void,
): { readonly value: T | undefined; readonly change: (next: T) => void } {
  const [draft, setDraft] = useState<T | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<T | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const change = (next: T) => {
    setDraft(next);
    latest.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      save(next, {
        onSuccess: () => {
          // A change made while saving keeps its own draft until its own save lands.
          if (latest.current === next) setDraft(undefined);
          announce(m.settings_saved());
        },
        onError: () => {
          if (latest.current === next) setDraft(undefined);
          toast({ title: m.state_not_saved(), type: "error" });
        },
      });
    }, autosaveDelay);
  };

  return { value: draft ?? server, change };
}
