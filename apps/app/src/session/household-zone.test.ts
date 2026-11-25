import type { KeyValueStorage } from "../data/store.ts";
import { describe, expect, it } from "vitest";
import { zoneInEffect, isTimeZone, loadZone, saveZone, zoneStorageKey } from "./household-zone.ts";

/** In-memory storage; `broken` makes every call fail like a locked keystore. */
const memoryStorage = (initial: Record<string, string> = {}, broken = false) => {
  const items = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItemAsync: (key) =>
      broken ? Promise.reject(new Error("locked")) : Promise.resolve(items.get(key) ?? null),
    setItemAsync: (key, value) => {
      if (broken) return Promise.reject(new Error("locked"));
      items.set(key, value);
      return Promise.resolve();
    },
  };
  return { storage, items };
};

describe("household zone", () => {
  it("prefers the server's answer, else the zone remembered from last time", () => {
    expect(zoneInEffect("Europe/Berlin", "America/New_York")).toBe("Europe/Berlin");
    expect(zoneInEffect(undefined, "Europe/Berlin")).toBe("Europe/Berlin");
    expect(zoneInEffect(undefined, undefined)).toBeUndefined();
    // A zone this device's Intl does not know never reaches the formatters.
    expect(zoneInEffect("Mars/Olympus", "Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("remembers the zone across starts, so a warm start paints in it", async () => {
    const { storage, items } = memoryStorage();
    expect(await loadZone(storage)).toBeUndefined();
    await saveZone(storage, "Europe/Berlin");
    expect(items.get(zoneStorageKey)).toBe("Europe/Berlin");
    expect(await loadZone(storage)).toBe("Europe/Berlin");
  });

  it("ignores a damaged value and a storage that cannot be read or written", async () => {
    expect(await loadZone(memoryStorage({ [zoneStorageKey]: "not a zone" }).storage)).toBe(
      undefined,
    );
    const broken = memoryStorage({}, true).storage;
    expect(await loadZone(broken)).toBeUndefined();
    await expect(saveZone(broken, "Europe/Berlin")).resolves.toBeUndefined();
  });

  it("knows real zones only", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Nowhere/Special")).toBe(false);
  });
});
