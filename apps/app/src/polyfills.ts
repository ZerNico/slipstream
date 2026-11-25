/*
 * What Hermes (the app's JavaScript engine) lacks of the ES2023 the shared packages are written
 * in: `toSorted`, `findLast` and `findLastIndex` on arrays. Loaded first by the root layout, so
 * every module after it can use them. Each one is added only when missing.
 */

type Compare<T> = ((a: T, b: T) => number) | undefined;

const define = (name: string, value: unknown) => {
  if (name in Array.prototype) return;
  // Adding a missing standard method is the point of a polyfill.
  // oxlint-disable-next-line no-extend-native
  Object.defineProperty(Array.prototype, name, { value, writable: true, configurable: true });
};

define("toSorted", function toSorted<T>(this: T[], compare: Compare<T>): T[] {
  // `toSorted` itself, on a copy: `sort` is all Hermes has.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...this].sort(compare);
});

define("findLast", function findLast<
  T,
>(this: T[], predicate: (value: T, index: number) => boolean): T | undefined {
  for (let index = this.length - 1; index >= 0; index -= 1) {
    const value = this[index] as T;
    if (predicate(value, index)) return value;
  }
  return undefined;
});

define("findLastIndex", function findLastIndex<
  T,
>(this: T[], predicate: (value: T, index: number) => boolean): number {
  for (let index = this.length - 1; index >= 0; index -= 1) {
    if (predicate(this[index] as T, index)) return index;
  }
  return -1;
});
