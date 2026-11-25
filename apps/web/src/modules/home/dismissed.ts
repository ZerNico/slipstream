import { useSyncExternalStore } from "react";

/**
 * Attention cards this device dismissed. Client-only by design: dismissing hides a card here,
 * it doesn't fix anything, and the Problems tab still lists it.
 */
const storageKey = "ss-home.dismissed";
const listeners = new Set<() => void>();
const empty: ReadonlySet<string> = new Set();
let cached: { raw: string | null; ids: ReadonlySet<string> } = { raw: null, ids: empty };

const read = (): ReadonlySet<string> => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    raw = null;
  }
  if (raw === cached.raw) return cached.ids;
  let ids: ReadonlySet<string> = empty;
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    ids = new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    ids = empty;
  }
  cached = { raw, ids };
  return ids;
};

const write = (ids: ReadonlySet<string>) => {
  try {
    if (ids.size === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    // Without storage a dismissed card simply comes back after a reload.
    cached = { raw: JSON.stringify([...ids]), ids };
  }
  for (const notify of listeners) notify();
};

/** Hides one card on this device. */
export const dismissIssue = (id: string): void => write(new Set([...read(), id]));

/** Shows a dismissed card again (Undo). */
export const restoreIssue = (id: string): void =>
  write(new Set([...read()].filter((other) => other !== id)));

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

/** The ids dismissed on this device, updating when they change. */
export const useDismissedIssues = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, read, () => empty);
