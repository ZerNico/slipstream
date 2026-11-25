/**
 * Writes `openapi.json` next to this package's `package.json` from the HttpApi definition.
 * Run with `pnpm --filter @slipstream/api openapi`; a test fails when the committed file is stale.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openApiSpec } from "../src/api.ts";

const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(openApiSpec(), null, 2)}\n`);
console.log(`Wrote ${target}`);
