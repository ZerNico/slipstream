/**
 * A migration that has shipped is never edited: drizzle records each one as applied and never
 * runs it again, so an edit only reaches fresh databases and existing ones silently miss it.
 * `applied-migrations.json` (next to this test) holds each migration's checksum. A new migration is added there once;
 * a change to an existing one belongs in a new migration instead.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsFolder } from "../src/db/migrate.ts";

const checksum = (folder: string) =>
  createHash("sha256")
    .update(readFileSync(join(migrationsFolder, folder, "migration.sql")))
    .digest("hex");

const recorded: Record<string, string> = JSON.parse(
  readFileSync(new URL("applied-migrations.json", import.meta.url), "utf8"),
);
const folders = readdirSync(migrationsFolder, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

describe("migrations", () => {
  it("are all recorded in applied-migrations.json", () => {
    expect(folders).toEqual(Object.keys(recorded).toSorted());
  });

  it.each(folders)("%s is unchanged since it was recorded", (folder) => {
    expect(checksum(folder), `${folder} changed; put the change in a new migration`).toBe(
      recorded[folder],
    );
  });
});
