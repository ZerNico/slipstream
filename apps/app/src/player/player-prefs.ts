import { defaultFit, type FitMode, type QualityChoice, qualityChoices } from "@slipstream/domain";
import { persistedStore, useStore } from "../data/store.ts";

/*
 * The player's choices on this device, not the account (SPEC §7.1): Fit or Fill and the quality.
 */

/** What the player remembers on this device. */
export interface PlayerPrefs {
  readonly fit: FitMode;
  readonly quality: QualityChoice;
}

/** A fresh device: the picture fills the screen, at the server's default quality. */
export const defaultPrefs: PlayerPrefs = { fit: defaultFit, quality: "auto" };

/** Reads stored choices, keeping the default for anything missing or malformed. */
export const parsePrefs = (raw: string | null): PlayerPrefs => {
  if (raw === null) return defaultPrefs;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return defaultPrefs;
  }
  const record = typeof value === "object" && value !== null ? value : {};
  const fit = "fit" in record ? record.fit : undefined;
  const quality = "quality" in record ? record.quality : undefined;
  return {
    fit: fit === "fit" || fit === "fill" ? fit : defaultPrefs.fit,
    quality: qualityChoices.find((choice) => choice === quality) ?? defaultPrefs.quality,
  };
};

/** The choices on this device; the root layout loads them at start. */
export const playerPrefs = persistedStore<PlayerPrefs>({
  key: "slipstream.player",
  initial: defaultPrefs,
  parse: (raw) => parsePrefs(raw),
  serialise: (prefs) => JSON.stringify(prefs),
});

/** Changes some choices, tells every player and stores them. */
export const savePrefs = (patch: Partial<PlayerPrefs>): void =>
  playerPrefs.set({ ...playerPrefs.get(), ...patch });

/** The choices in effect, re-rendering when they change. */
export const usePlayerPrefs = (): PlayerPrefs => useStore(playerPrefs);
