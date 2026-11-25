/**
 * SQLite access. One writer connection and one read-only connection on the same WAL database:
 *
 * - The writer serialises every statement and transaction behind its own semaphore (one
 *   connection, `BEGIN IMMEDIATE`), so there is exactly one writer at a time and multi-statement
 *   changes never interleave.
 * - Readers use the second connection, so a long guide import transaction does not hold up the
 *   guide grid between its statements.
 * - `busy_timeout` covers the moments both touch the file at once.
 *
 * Migrations run on startup, after a `VACUUM INTO` backup whenever something is pending.
 */
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { type EffectSQLiteNodeDatabase, makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Context, Effect, Layer } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import { ServerConfig } from "../config.ts";
import { migrateWithBackup, type MigrationReport, PRIVATE_DIR, PRIVATE_FILE } from "./migrate.ts";

/** A Drizzle database handle on one of the two connections. */
export type Database = EffectSQLiteNodeDatabase;

/** The transaction handle `write.transaction` passes to its callback. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** File name of the database inside the config directory. */
export const databaseFile = "slipstream.db";

/** Both connections plus what startup migration did. */
export interface DbShape {
  /** The single writer. Use `write.transaction` for changes that span statements. */
  readonly write: Database;
  /** Read-only connection for queries that do not need to see an open write transaction. */
  readonly read: Database;
  /** Migrations applied on this start and the backup taken before them. */
  readonly migrations: MigrationReport;
}

const BUSY_TIMEOUT = "5 seconds";

const openClient = (filename: string, readonly: boolean) =>
  SqliteClient.make({ filename, readonly, busyTimeout: BUSY_TIMEOUT }).pipe(
    Effect.provide(Reactivity.layer),
  );

const drizzleOn = (client: SqliteClient.SqliteClient) =>
  makeWithDefaults().pipe(Effect.provideService(SqliteClient.SqliteClient, client));

/** The database, migrated and ready. */
export class Db extends Context.Service<Db, DbShape>()("@slipstream/server/Db") {
  static readonly layer = Layer.effect(
    Db,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      // Accounts, sessions and sealed source secrets live here: owner only.
      mkdirSync(config.configDir, { recursive: true, mode: PRIVATE_DIR });
      const filename = join(config.configDir, databaseFile);
      // Created owner-only before SQLite opens it; SQLite gives the WAL and SHM files the
      // database's mode, and they are tightened below in case they predate this.
      closeSync(openSync(filename, "a", PRIVATE_FILE));
      chmodSync(filename, PRIVATE_FILE);

      const writer = yield* openClient(filename, false);
      yield* writer.unsafe("PRAGMA foreign_keys = ON").raw;
      yield* writer.unsafe("PRAGMA synchronous = NORMAL").raw;
      const write = yield* drizzleOn(writer);

      const migrations = yield* migrateWithBackup(write, writer, {
        backupDir: join(config.configDir, "backups"),
      });

      const reader = yield* openClient(filename, true);
      const read = yield* drizzleOn(reader);
      for (const companion of [`${filename}-wal`, `${filename}-shm`]) {
        if (existsSync(companion)) chmodSync(companion, PRIVATE_FILE);
      }
      return { write, read, migrations } satisfies DbShape;
    }).pipe(Effect.orDie),
  );
}
