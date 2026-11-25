/**
 * Source rows to domain sources and back: this module only seals and opens. Configs, secret
 * headers and stream URLs (which carry provider credentials) are sealed at rest by
 * {@link SecretBox}; only this module and the recorder's line-up open them.
 */
import { Effect, Schema } from "effect";
import { type Source, SourceConfig, SourceId } from "@slipstream/domain";
import { opt, toInstant } from "../db/codec.ts";
import type { sources } from "../db/schema.ts";
import type { SecretBox } from "./secret-box.ts";

/** A `sources` row as stored. */
export type SourceRow = typeof sources.$inferSelect;

const decodeConfig = Schema.decodeUnknownEffect(SourceConfig);
const decodeHeaders = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.String));

/** The full source of a row, secrets opened. Dies on a row that does not decode. */
export const sourceFromRow = (box: SecretBox["Service"], row: SourceRow) =>
  Effect.gen(function* () {
    const config = yield* Effect.flatMap(box.open(row.config), decodeConfig);
    const secretHeaders =
      row.secretHeaders === null
        ? undefined
        : yield* Effect.flatMap(box.open(row.secretHeaders), decodeHeaders);
    return {
      id: SourceId.make(row.id),
      name: row.name,
      config,
      refreshIntervalMinutes: row.refreshIntervalMinutes,
      ...opt("maxStreams", row.maxStreams),
      ...opt("keptForRecordings", row.keptForRecordings),
      ...opt("userAgent", row.userAgent),
      headers: row.headers,
      ...(secretHeaders === undefined || Object.keys(secretHeaders).length === 0
        ? {}
        : { secretHeaders }),
      guideCleanup: row.guideCleanup,
      enabled: row.enabled,
      health: row.health,
      ...opt("lastRefreshAt", row.lastRefreshAt === null ? null : toInstant(row.lastRefreshAt)),
      autoAddNew: row.autoAddNew,
      ...opt("reviewedAt", row.reviewedAt === null ? null : toInstant(row.reviewedAt)),
    } satisfies Source;
  }).pipe(Effect.orDie);

/** The sealed columns for a source's secrets. */
export const sealedColumns = (
  box: SecretBox["Service"],
  source: Pick<Source, "config" | "secretHeaders">,
) => ({
  config: box.seal(source.config),
  secretHeaders:
    source.secretHeaders === undefined || Object.keys(source.secretHeaders).length === 0
      ? null
      : box.seal(source.secretHeaders),
});

/** A stream URL for its `source_streams` row: sealed, since it may carry credentials. */
export const sealStreamUrl = (box: SecretBox["Service"], url: string): string => box.seal(url);

const decodeUrl = Schema.decodeUnknownEffect(Schema.String);

/** A stream URL from its row. Dies on one that does not open. */
export const openStreamUrl = (box: SecretBox["Service"], stored: string) =>
  Effect.flatMap(box.open(stored), decodeUrl).pipe(Effect.orDie);
