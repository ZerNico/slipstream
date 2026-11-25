/**
 * Startup migrations (PLAN section 11): forward-only, applied automatically, and preceded by a
 * `VACUUM INTO` backup of the existing database whenever at least one migration is pending.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqliteClient } from "@effect/sql-sqlite-node";
import { migrate } from "drizzle-orm/effect-sqlite-node/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { DateTime, Effect } from "effect";
import type { EffectSQLiteNodeDatabase } from "drizzle-orm/effect-sqlite-node";

/** Where drizzle-kit writes migrations (`apps/server/drizzle`). */
export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const migrationsTable = "__drizzle_migrations";

/** Mode of the database, its WAL and SHM files and backups: read and write for the owner only. */
export const PRIVATE_FILE = 0o600;
/** Mode of the config and backup directories. */
export const PRIVATE_DIR = 0o700;

/** What startup migration did. */
export interface MigrationReport {
  /** Migration folder names applied on this start, oldest first. */
  readonly applied: ReadonlyArray<string>;
  /** The backup written before applying them; absent for a fresh database or nothing pending. */
  readonly backup: string | undefined;
}

const tableExists = (client: SqliteClient.SqliteClient, name: string) =>
  client
    .unsafe<{ readonly name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    )
    .pipe(Effect.map((rows) => rows.length > 0));

const appliedMigrations = (client: SqliteClient.SqliteClient) =>
  Effect.gen(function* () {
    if (!(yield* tableExists(client, migrationsTable))) return new Set<string>();
    const rows = yield* client.unsafe<{ readonly name: string | null }>(
      `SELECT name FROM "${migrationsTable}"`,
    );
    return new Set(rows.flatMap((row) => (row.name === null ? [] : [row.name])));
  });

const hasData = (client: SqliteClient.SqliteClient) =>
  client
    .unsafe<{ readonly count: number }>(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .pipe(Effect.map((rows) => (rows[0]?.count ?? 0) > 0));

/** `2026-11-21T13-38-15Z`: sortable and safe in file names on every platform. */
const fileStamp = (now: DateTime.Utc) =>
  DateTime.formatIso(now)
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");

/**
 * Applies pending migrations from `folder`. When the database already holds tables, it is first
 * copied to `backupDir/slipstream-<time>-before-<first pending migration>.db`.
 */
export const migrateWithBackup = Effect.fn("migrateWithBackup")(function* (
  db: EffectSQLiteNodeDatabase,
  client: SqliteClient.SqliteClient,
  options: { readonly backupDir: string; readonly folder?: string | undefined },
) {
  const folder = options.folder ?? migrationsFolder;
  const local = readMigrationFiles({ migrationsFolder: folder });
  const done = yield* appliedMigrations(client);
  const pending = local.flatMap((migration) =>
    migration.name !== undefined && !done.has(migration.name) ? [migration.name] : [],
  );
  const first = pending[0];
  if (first === undefined) return { applied: [], backup: undefined } satisfies MigrationReport;

  let backup: string | undefined;
  if (yield* hasData(client)) {
    // Backups hold everything the database does: owner only.
    mkdirSync(options.backupDir, { recursive: true, mode: PRIVATE_DIR });
    chmodSync(options.backupDir, PRIVATE_DIR);
    backup = join(
      options.backupDir,
      `slipstream-${fileStamp(yield* DateTime.now)}-before-${first}.db`,
    );
    yield* client.unsafe("VACUUM INTO ?", [backup]).raw;
    chmodSync(backup, PRIVATE_FILE);
    yield* Effect.logInfo("Backed up the database before migrating").pipe(
      Effect.annotateLogs({ backup, pending: pending.join(", ") }),
    );
  }
  yield* migrate(db, { migrationsFolder: folder, migrationsTable });
  yield* Effect.logInfo("Applied database migrations").pipe(
    Effect.annotateLogs({ applied: pending.join(", ") }),
  );
  return { applied: pending, backup } satisfies MigrationReport;
});
