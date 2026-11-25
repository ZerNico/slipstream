import { describe, expect, it } from "vitest";
import { type KeyValueStorage, memoryStore, persistedStore } from "./store.ts";

const fakeStorage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItemAsync: (key) => Promise.resolve(items.get(key) ?? null),
    setItemAsync: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
  return { storage, items };
};

const numbers = () =>
  persistedStore<number>({
    key: "n",
    initial: 0,
    parse: (raw, current) => (raw === null ? current : Number(raw)),
    serialise: (value) => (value === 0 ? undefined : String(value)),
  });

describe("memoryStore", () => {
  it("tells listeners about a new value, not about the same one", () => {
    const store = memoryStore(1);
    let heard = 0;
    const stop = store.subscribe(() => {
      heard += 1;
    });
    store.set(1);
    store.set(2);
    expect(store.get()).toBe(2);
    expect(heard).toBe(1);
    stop();
    store.set(3);
    expect(heard).toBe(1);
  });
});

describe("persistedStore", () => {
  it("loads what was stored and writes every change back", async () => {
    const { storage, items } = fakeStorage({ n: "4" });
    const store = numbers();
    await store.load(storage);
    expect(store.get()).toBe(4);
    store.set(7);
    expect(items.get("n")).toBe("7");
    store.set(0);
    expect(items.has("n")).toBe(false);
  });

  it("keeps its value when nothing is stored or the storage fails", async () => {
    const store = numbers();
    await store.load(fakeStorage().storage);
    expect(store.get()).toBe(0);
    const broken: KeyValueStorage = {
      getItemAsync: () => Promise.reject(new Error("locked")),
      setItemAsync: () => Promise.reject(new Error("locked")),
    };
    const other = numbers();
    await other.load(broken);
    other.set(5);
    expect(other.get()).toBe(5);
  });
});
