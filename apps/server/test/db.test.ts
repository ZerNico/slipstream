import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { assert, describe, it } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Context, Effect, Layer } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import { ServerConfig } from "../src/config.ts";
import { Db } from "../src/db/client.ts";
import { migrateWithBackup, migrationsFolder } from "../src/db/migrate.ts";
import { defaultLayout, isAnchor } from "@slipstream/domain";
import {
  channels,
  collections,
  programmes,
  recordingOwners,
  recordings,
  rules,
  sources,
  users,
} from "../src/db/schema.ts";
import { ftsQuery } from "../src/guide/service.ts";
import { loadRecording, retainedEndSql, retainedStartSql } from "../src/recordings/store.ts";
import { tempDir, testSettings } from "./support.ts";

/** Opens the database for the rest of the surrounding scope. */
const openDb = (root: string) =>
  Layer.build(Db.layer.pipe(Layer.provide(ServerConfig.layerWith(testSettings(root))))).pipe(
    Effect.map((context) => Context.get(context, Db)),
  );

/** A recording row on channel c1, with `hidden` fields on top. */
const recording = (id: string, hidden: Partial<typeof recordings.$inferInsert>) => ({
  id,
  channelId: "c1",
  start: 0,
  end: 1,
  title: "Tatort",
  categories: [],
  repeat: false,
  live: false,
  paddingBeforeMinutes: 0,
  paddingAfterMinutes: 0,
  state: "failed" as const,
  problems: [],
  protected: false,
  exportStatus: "none" as const,
  createdAt: 0,
  ...hidden,
});

describe("Db", () => {
  it.effect("migrates a fresh database without a backup, then reports nothing pending", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const first = yield* Effect.scoped(Effect.map(openDb(root), (db) => db.migrations));
      assert.isTrue(first.applied.length >= 2);
      assert.isUndefined(first.backup);

      const second = yield* Effect.scoped(Effect.map(openDb(root), (db) => db.migrations));
      assert.deepStrictEqual(second.applied, []);
    }).pipe(Effect.scoped),
  );

  it.effect("writes through the writer and reads through the read-only connection", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const db = yield* openDb(root);
      yield* db.write.insert(channels).values({
        id: "c1",
        name: "Das Erste",
        favourite: false,
        hidden: false,
      });
      const rows = yield* db.read.select().from(channels).where(eq(channels.id, "c1"));
      assert.strictEqual(rows[0]?.name, "Das Erste");
      const readOnly = yield* db.read
        .insert(channels)
        .values({ id: "c2", name: "ZDF", favourite: false, hidden: false })
        .pipe(Effect.flip);
      assert.strictEqual(readOnly._tag, "EffectDrizzleQueryError");
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the FTS5 guide index in sync with programmes", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const db = yield* openDb(root);
      yield* db.write.insert(sources).values({
        id: "s1",
        name: "Test",
        config: JSON.stringify({ _tag: "M3u", playlistUrl: "http://example.test/p.m3u" }),
        refreshIntervalMinutes: 60,
        headers: {},
        guideCleanup: { removeDuplicates: true, rewrites: [] },
        enabled: true,
        health: "unknown",
      });
      const base = {
        sourceId: "s1",
        guideChannelId: "ard.de",
        categories: [],
        repeat: false,
        live: false,
      };
      yield* db.write.insert(programmes).values([
        { ...base, id: "p1", start: 0, end: 1, title: "Tagesschau", description: "Nachrichten" },
        { ...base, id: "p2", start: 1, end: 2, title: "Übersicht der Woche" },
        { ...base, id: "p3", start: 2, end: 3, title: "Kurzsendung 16:04" },
        { ...base, id: "p4", start: 3, end: 4, title: "Kurzsendung 04:16" },
      ]);
      const search = (term: string) =>
        db.read.all<{ id: string }>(
          sql`SELECT p.id FROM programmes_fts f JOIN programmes p ON p.rowid = f.rowid WHERE programmes_fts MATCH ${term}`,
        );
      assert.deepStrictEqual(yield* search("nachricht*"), [{ id: "p1" }]);
      assert.deepStrictEqual(yield* search("ubersicht"), [{ id: "p2" }]);
      // What someone types, through ftsQuery: a time in a title is found as typed.
      assert.deepStrictEqual(yield* search(ftsQuery("Kurzsendung 16:04") ?? ""), [{ id: "p3" }]);
      assert.deepStrictEqual(yield* search(ftsQuery("16:0") ?? ""), [{ id: "p3" }]);
      yield* db.write.delete(programmes).where(eq(programmes.id, "p1"));
      assert.deepStrictEqual(yield* search("nachricht*"), []);
    }).pipe(Effect.scoped),
  );

  it.effect("reads why a recording is hidden", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const db = yield* openDb(root);
      yield* db.write.insert(users).values({
        id: "jonas",
        username: "jonas",
        displayName: "Jonas",
        role: "user",
        passwordHash: "!",
        createdAt: 0,
      });
      yield* db.write.insert(channels).values({
        id: "c1",
        name: "Das Erste",
        favourite: false,
        hidden: false,
      });
      yield* db.write
        .insert(recordings)
        .values([
          recording("anchor", { hiddenAt: 5, hiddenReason: "deleted" }),
          recording("shown", {}),
        ]);
      yield* db.write
        .insert(recordingOwners)
        .values(
          ["anchor", "shown"].map((recordingId) => ({ recordingId, userId: "jonas", addedAt: 0 })),
        );
      const anchor = yield* loadRecording(db.read, "anchor");
      assert.strictEqual(anchor?.recording.hiddenReason, "deleted");
      assert.isTrue(anchor !== undefined && isAnchor(anchor.recording));
      const shown = yield* loadRecording(db.read, "shown");
      assert.isFalse(shown === undefined || "hiddenReason" in shown.recording);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "reads the retained range as numbers, not the BigInt SQLite gives raw expressions",
    () =>
      Effect.gen(function* () {
        const root = yield* tempDir;
        const db = yield* openDb(root);
        yield* db.write.insert(channels).values({
          id: "c1",
          name: "Das Erste",
          favourite: false,
          hidden: false,
        });
        const start = Date.parse("2026-11-25T20:15:00Z");
        yield* db.write.insert(recordings).values(
          recording("r", {
            start,
            end: start + 3_600_000,
            paddingBeforeMinutes: 2,
            paddingAfterMinutes: 5,
          }),
        );
        const [row] = yield* db.read
          .select({ start: retainedStartSql, end: retainedEndSql })
          .from(recordings);
        // The streams overview takes `Math.max` of the start, which throws on a BigInt.
        assert.deepStrictEqual(row, { start: start - 120_000, end: start + 3_900_000 });
      }).pipe(Effect.scoped),
  );

  it.effect("refuses to delete a rule a collection follows (the restrict foreign key)", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const db = yield* openDb(root);
      yield* db.write.insert(users).values({
        id: "jonas",
        username: "jonas",
        displayName: "Jonas",
        role: "user",
        passwordHash: "!",
        createdAt: 0,
      });
      const matcher = { channels: [], title: [], categories: [], weekdays: [] };
      yield* db.write.insert(rules).values({
        id: "live-f1",
        name: "Live F1",
        enabled: true,
        ownerId: "jonas",
        matcher,
        paddingBeforeMinutes: 0,
        paddingAfterMinutes: 0,
        retention: { _tag: "KeepAll" },
        createdAt: 0,
      });
      yield* db.write.insert(collections).values({
        id: "formel-1",
        name: "Formel 1",
        rank: 0,
        matcher,
        labels: [],
        layout: defaultLayout,
        ruleId: "live-f1",
      });
      const refused = yield* db.write
        .delete(rules)
        .where(eq(rules.id, "live-f1"))
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, "EffectDrizzleQueryError");
      const [still] = yield* db.read.select().from(rules).where(eq(rules.id, "live-f1"));
      assert.isDefined(still);
    }).pipe(Effect.scoped),
  );
});

describe("channel management migration", () => {
  it.effect("upgrades without new streams or number clashes: old streams count as reviewed", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const all = readdirSync(migrationsFolder).toSorted();
      const target = "20261125133819_channel_management";
      const partial = join(root, "partial");
      for (const folder of all.slice(0, all.indexOf(target))) {
        cpSync(join(migrationsFolder, folder), join(partial, folder), { recursive: true });
      }
      const client = yield* SqliteClient.make({ filename: join(root, "test.db") }).pipe(
        Effect.provide(Reactivity.layer),
      );
      const db = yield* makeWithDefaults().pipe(
        Effect.provideService(SqliteClient.SqliteClient, client),
      );
      const backupDir = join(root, "backups");
      yield* migrateWithBackup(db, client, { backupDir, folder: partial });
      yield* client.unsafe(
        `INSERT INTO sources (id, name, config, refresh_interval_minutes, headers, guide_cleanup, enabled, health, last_refresh_at) VALUES ('s1', 'Old', 'x', 60, '{}', '{}', 1, 'ok', 500)`,
      );
      yield* client.unsafe(
        `INSERT INTO source_streams (id, source_id, upstream_id, name, url, last_seen_at) VALUES ('st1', 's1', 'u1', 'ZDF', 'x', 500)`,
      );
      const upgrade = yield* migrateWithBackup(db, client, { backupDir });
      assert.include(upgrade.applied, target);
      const [stream] = yield* client.unsafe<{ first_seen_at: number; ignored_at: null }>(
        "SELECT first_seen_at, ignored_at FROM source_streams",
      );
      assert.deepStrictEqual(stream, { first_seen_at: 500, ignored_at: null });
      const [source] = yield* client.unsafe<{ reviewed_at: number; auto_add_new: number }>(
        "SELECT reviewed_at, auto_add_new FROM sources",
      );
      assert.deepStrictEqual(source, { reviewed_at: 500, auto_add_new: 0 });
    }).pipe(Effect.scoped),
  );
});

describe("migrateWithBackup", () => {
  it.effect("backs the database up before applying a pending migration", () =>
    Effect.gen(function* () {
      const root = yield* tempDir;
      const [first = "", ...rest] = readdirSync(migrationsFolder).toSorted();
      const partial = join(root, "partial");
      cpSync(join(migrationsFolder, first), join(partial, first), { recursive: true });

      const client = yield* SqliteClient.make({ filename: join(root, "test.db") }).pipe(
        Effect.provide(Reactivity.layer),
      );
      const db = yield* makeWithDefaults().pipe(
        Effect.provideService(SqliteClient.SqliteClient, client),
      );
      const backupDir = join(root, "backups");

      const initial = yield* migrateWithBackup(db, client, { backupDir, folder: partial });
      assert.deepStrictEqual(initial, { applied: [first], backup: undefined });

      const upgrade = yield* migrateWithBackup(db, client, { backupDir });
      assert.deepStrictEqual(upgrade.applied, rest);
      const backupFile = upgrade.backup ?? "";
      assert.include(backupFile, `before-${rest[0]}`);
      assert.isTrue(existsSync(backupFile));
      // Backups hold accounts and sealed secrets: owner only, like the database.
      assert.strictEqual(statSync(backupDir).mode & 0o777, 0o700);
      assert.strictEqual(statSync(backupFile).mode & 0o777, 0o600);

      // The backup is the database as it was: tables of the first migration, no search index.
      const backup = new DatabaseSync(backupFile, { readOnly: true });
      const tables = backup
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String(row["name"]));
      backup.close();
      assert.include(tables, "recordings");
      assert.notInclude(tables, "programmes_fts");

      const again = yield* migrateWithBackup(db, client, { backupDir });
      assert.deepStrictEqual(again, { applied: [], backup: undefined });
    }).pipe(Effect.scoped),
  );
});
