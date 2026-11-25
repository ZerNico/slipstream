import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit settings. Generating migrations only diffs the schema against the snapshots in
 * ./drizzle; it never opens a database. The server applies them on startup (src/db/migrate.ts).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
