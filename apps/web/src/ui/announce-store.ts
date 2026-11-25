/** The text of the polite live region, shared by `announce()` and the `Announcer`. */
let message = "";

/** The current announcement. */
export const currentAnnouncement = (): string => message;
const listeners = new Set<() => void>();

/**
 * Says something politely to assistive tech: in-place results like "Collection created" or
 * "Signed out". One live region for the app, separate from toasts (SPEC §7.3, §10).
 */
export const announce = (text: string): void => {
  // Clear first, so the same words announced twice are heard twice.
  message = "";
  for (const listener of listeners) listener();
  window.setTimeout(() => {
    message = text;
    for (const listener of listeners) listener();
  }, 40);
};

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
