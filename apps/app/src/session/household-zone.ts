/**
 * The household's time zone (`system.timeZone`), remembered on the device so a warm start paints
 * every clock time in it before the server answers. Pure apart from the storage it is handed.
 */

import type { KeyValueStorage } from "../data/store.ts";

/** The storage key (SecureStore allows letters, digits, `.`, `-` and `_`). */
export const zoneStorageKey = "slipstream.householdZone";

/** Whether `Intl` knows the zone, so a damaged stored value never breaks formatting. */
export const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};

/** The zone remembered from last time; undefined when there is none, or it cannot be read. */
export const loadZone = (storage: KeyValueStorage): Promise<string | undefined> =>
  storage.getItemAsync(zoneStorageKey).then(
    (value) => (value !== null && isTimeZone(value) ? value : undefined),
    () => undefined,
  );

/** Remembers the zone the server named; a storage failure only costs the next warm start. */
export const saveZone = (storage: KeyValueStorage, zone: string): Promise<void> =>
  storage.setItemAsync(zoneStorageKey, zone).catch(() => undefined);

/**
 * The zone in effect: what the server says now, else what it said last time, else undefined
 * (the device's zone applies).
 */
export const zoneInEffect = (
  fetched: string | undefined,
  remembered: string | undefined,
): string | undefined => (fetched !== undefined && isTimeZone(fetched) ? fetched : remembered);
