/**
 * Small validators for route search params (TanStack Router `validateSearch`). Unknown or
 * malformed values are dropped rather than failing the route, so a hand-edited URL still opens.
 */

/** A non-empty string, or absent. */
export const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== ""
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;

/** A finite number (also from a numeric string), or absent. */
export const optionalNumber = (value: unknown): number | undefined => {
  const number = typeof value === "string" && value !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
};

/** One of `allowed`, or absent. */
export const optionalEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined => allowed.find((candidate) => candidate === value);

/** Drops absent keys, so `exactOptionalPropertyTypes` holds and URLs stay short. */
export const compact = <T extends Record<string, unknown>>(
  record: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
