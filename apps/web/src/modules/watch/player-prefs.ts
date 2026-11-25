import { useSyncExternalStore } from "react";
import { defaultFit, type FitMode, type QualityChoice, qualityChoices } from "@slipstream/domain";

/*
 * Player preferences of this device, not the account (SPEC §7.1): Fill or Fit, volume, mute,
 * the quality override, the playback stats overlay. One `ss-player.*` key each, so a broken value spoils nothing else.
 * Blocked or empty storage (private windows) means the defaults and a player that forgets.
 */

/** What the player remembers on this device. */
export interface PlayerPrefs {
  readonly fit: FitMode;
  /** 0 to 100. */
  readonly volume: number;
  readonly muted: boolean;
  readonly quality: QualityChoice;
  /** The playback stats overlay. */
  readonly stats: boolean;
}

/** A fresh device: fill, full volume, sound on, automatic quality. */
export const defaultPrefs: PlayerPrefs = {
  fit: defaultFit,
  volume: 100,
  muted: false,
  quality: "auto",
  stats: false,
};

/** The storage keys, one per preference. */
export const prefKeys = {
  fit: "ss-player.fit",
  volume: "ss-player.vol",
  muted: "ss-player.muted",
  quality: "ss-player.quality",
  stats: "ss-player.stats",
} as const;

/** The part of `Storage` the preferences use, so tests can pass a plain map. */
export interface PrefStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

const read = (storage: PrefStorage | undefined, key: string): string | null => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

/** Reads every preference, keeping the default for anything missing or malformed. */
export const readPrefs = (storage: PrefStorage | undefined): PlayerPrefs => {
  const fit = read(storage, prefKeys.fit);
  const volume = Number(read(storage, prefKeys.volume) ?? Number.NaN);
  const muted = read(storage, prefKeys.muted);
  const quality = read(storage, prefKeys.quality);
  const stats = read(storage, prefKeys.stats);
  return {
    fit: fit === "fit" || fit === "fill" ? fit : defaultPrefs.fit,
    volume: Number.isFinite(volume) ? clampVolume(volume) : defaultPrefs.volume,
    muted: muted === "true" ? true : muted === "false" ? false : defaultPrefs.muted,
    quality: qualityChoices.find((choice) => choice === quality) ?? defaultPrefs.quality,
    stats: stats === "true",
  };
};

/** A volume held to 0 to 100, whole percent. */
export const clampVolume = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

const browserStorage = (): PrefStorage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const listeners = new Set<() => void>();
let cached: { key: string; prefs: PlayerPrefs } | null = null;

const snapshot = (): PlayerPrefs => {
  const prefs = readPrefs(browserStorage());
  const key = JSON.stringify(prefs);
  if (cached?.key !== key) cached = { key, prefs };
  return cached.prefs;
};

/** Stores some preferences on this device and tells every player that reads them. */
export const savePrefs = (patch: Partial<PlayerPrefs>): void => {
  const storage = browserStorage();
  const write = (key: string, value: string) => {
    try {
      storage?.setItem(key, value);
    } catch {
      // Blocked storage: the change holds for this page only, through the cache below.
    }
  };
  if (patch.fit !== undefined) write(prefKeys.fit, patch.fit);
  if (patch.volume !== undefined) write(prefKeys.volume, String(clampVolume(patch.volume)));
  if (patch.muted !== undefined) write(prefKeys.muted, String(patch.muted));
  if (patch.quality !== undefined) write(prefKeys.quality, patch.quality);
  if (patch.stats !== undefined) write(prefKeys.stats, String(patch.stats));
  const next = { ...snapshot(), ...patch };
  cached = { key: JSON.stringify(next), prefs: next };
  for (const notify of listeners) notify();
};

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

/** This device's player preferences, re-rendering when they change. */
export const usePlayerPrefs = (): PlayerPrefs =>
  useSyncExternalStore(
    subscribe,
    () => cached?.prefs ?? snapshot(),
    () => defaultPrefs,
  );
