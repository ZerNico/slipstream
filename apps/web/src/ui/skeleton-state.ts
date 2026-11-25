import { createContext, use, useEffect } from "react";
import { storageKeys } from "~/storage-keys.ts";

/** How long the first data paint waits for the UI fonts at most, ms (SPEC §6.3). */
export const fontWaitMs = 300;

export const LoadingContext = createContext(false);

/** Whether the nearest loading scope is still loading. */
export const useIsLoading = (): boolean => use(LoadingContext);

/** How many rows a remembered list draws at most, unless the list allows more. */
const maxRememberedRows = 50;

/**
 * How many rows a list had the last time this browser showed it (`key` names the list), at most
 * `cap`; `fallback` before the first load. A pure read: a per-viewer convenience in
 * localStorage, and unreadable storage just means the fallback.
 */
function readCount(key: string, fallback: number, cap = maxRememberedRows): number {
  try {
    const stored = localStorage.getItem(storageKeys.count(key));
    const parsed = stored === null ? Number.NaN : Number(stored);
    return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, cap) : fallback;
  } catch {
    return fallback;
  }
}

/** Remembers a list's loaded length for {@link readCount}; writes only when it changed. */
function writeCount(key: string, count: number): void {
  try {
    const storageKey = storageKeys.count(key);
    if (localStorage.getItem(storageKey) !== String(count)) {
      localStorage.setItem(storageKey, String(count));
    }
  } catch {
    // Without storage the skeleton falls back to its default.
  }
}

/**
 * A list's length for its skeleton, so it draws that many rows and nothing moves when the data
 * lands: `count` once loaded (remembered after the render), else the length this browser saw
 * last ({@link readCount}), else `fallback`.
 */
export function useRememberedCount(
  key: string,
  count: number | undefined,
  fallback: number,
  cap = maxRememberedRows,
): number {
  useEffect(() => {
    if (count !== undefined) writeCount(key, count);
  }, [key, count]);
  return count ?? readCount(key, fallback, cap);
}

/**
 * {@link useRememberedCount} for code that cannot call a hook (after an early return, in a
 * helper): the loaded `count` is remembered during render, though only when it changed.
 */
export function rememberedCount(key: string, count: number | undefined, fallback: number): number {
  if (count === undefined) return readCount(key, fallback);
  writeCount(key, count);
  return count;
}

/**
 * A list rendered at its expected length while loading (previous response or a per-route
 * default: the guide's channel count, five cards in a row), so nothing jumps when data lands.
 */
export function placeholderList<T>(
  items: readonly T[] | undefined,
  expected: number,
  make: (index: number) => T,
): readonly T[] {
  return items ?? Array.from({ length: expected }, (_, index) => make(index));
}

/**
 * {@link placeholderList} at the length this browser saw last ({@link rememberedCount}), else
 * `fallback`: the "previous response" shape of SPEC §6.2 across reloads.
 */
export function rememberedList<T>(
  key: string,
  items: readonly T[] | undefined,
  fallback: number,
  make: (index: number) => T,
): readonly T[] {
  return placeholderList(items, rememberedCount(key, items?.length, fallback), make);
}
