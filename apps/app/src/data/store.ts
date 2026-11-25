import { useSyncExternalStore } from "react";

/*
 * Small external stores for state outside React. A device choice (player Fit/Fill, recent
 * searches, the language) is read once at start, kept in memory and written back on every
 * change; a storage that fails only means the defaults next time.
 */

/** Where device choices are kept: SecureStore in the app, a fake in tests. */
export interface KeyValueStorage {
  readonly getItemAsync: (key: string) => Promise<string | null>;
  readonly setItemAsync: (key: string, value: string) => Promise<void>;
  readonly deleteItemAsync?: (key: string) => Promise<void>;
}

/** A value with listeners; `set` with the same value tells nobody. */
export interface Store<T> {
  readonly get: () => T;
  readonly set: (next: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** A store in memory only. */
export const memoryStore = <T>(initial: T): Store<T> => {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (Object.is(next, current)) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** A store kept on the device under one key. */
export interface PersistedStore<T> extends Store<T> {
  /** The storage key (SecureStore allows letters, digits, `.`, `-` and `_`). */
  readonly key: string;
  /** Reads the stored value once; later changes are written to the same storage. */
  readonly load: (storage: KeyValueStorage) => Promise<void>;
  /** Takes a value already read (synchronously, before the first frame) and the storage. */
  readonly attach: (storage: KeyValueStorage, raw: string | null) => void;
}

/**
 * A store kept on the device. `parse` reads what is stored (null: nothing) against what is in
 * memory, so a change made while it loads can survive; `serialise` gives what to store, or
 * undefined to forget the key.
 */
export const persistedStore = <T>(options: {
  readonly key: string;
  readonly initial: T;
  readonly parse: (raw: string | null, current: T) => T;
  readonly serialise: (value: T) => string | undefined;
}): PersistedStore<T> => {
  const store = memoryStore(options.initial);
  let storage: KeyValueStorage | undefined;
  const write = (value: T) => {
    const text = options.serialise(value);
    try {
      const done =
        text === undefined
          ? storage?.deleteItemAsync?.(options.key)
          : storage?.setItemAsync(options.key, text);
      done?.catch(() => undefined);
    } catch {
      // Not remembered this time; the value still changes now.
    }
  };
  const attach = (from: KeyValueStorage, raw: string | null) => {
    storage = from;
    store.set(options.parse(raw, store.get()));
  };
  return {
    ...store,
    key: options.key,
    set: (next) => {
      if (Object.is(next, store.get())) return;
      store.set(next);
      write(next);
    },
    attach,
    load: (from) =>
      from.getItemAsync(options.key).then(
        (raw) => attach(from, raw),
        () => {
          storage = from;
        },
      ),
  };
};

/** The store's value, re-rendering the caller when it changes. */
export const useStore = <T>(store: Store<T>): T =>
  useSyncExternalStore(store.subscribe, store.get, store.get);
