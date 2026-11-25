/**
 * Small conversions between SQLite rows and domain values.
 */
import { DateTime, Option, Schema } from "effect";
import { type Instant, StreamInfo } from "@slipstream/domain";

const StreamInfoJson = Schema.toCodecJson(StreamInfo);

/** `StreamInfo` as its JSON column holds it (instants as ISO strings). */
export type StoredStreamInfo = typeof StreamInfoJson.Encoded;

/** A `StreamInfo` for its JSON column. */
export const storeStreamInfo = Schema.encodeSync(StreamInfoJson);

/** A `StreamInfo` from its JSON column; `undefined` for a value that no longer decodes. */
export const readStreamInfo = (stored: unknown): StreamInfo | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(StreamInfoJson)(stored));

/** Epoch milliseconds from the database to an instant. */
export const toInstant = (millis: number): Instant => DateTime.makeUnsafe(millis);

/**
 * `{ [key]: value }` when the value is present, `{}` for null or undefined. Spread it to build
 * objects with optional keys from nullable columns under `exactOptionalPropertyTypes`.
 */
export const opt = <const K extends string, V>(
  key: K,
  value: V | null | undefined,
): { readonly [P in K]?: V } =>
  (value === null || value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V };

/** Splits an array into chunks, for multi-row inserts under SQLite's variable limit. */
export const chunks = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
  const result: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};
