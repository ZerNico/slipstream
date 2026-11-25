/**
 * The server with this checkout's dev settings: `pnpm dev` runs it under `node --watch`, and
 * `pnpm --filter @slipstream/server dev` runs it alone. It is the production entry (`main.ts`)
 * with `SLIPSTREAM_*` defaults for development: this checkout's port and `.data/dev`, loopback
 * only, no mDNS. Variables already set win. Seeding (dev admin, fake source, example rule) is
 * done by `pnpm dev` through the API, so nothing here or in `src/` knows about dev accounts.
 */
import { serverEnv } from "../../../scripts/dev-state.ts";

for (const [name, value] of Object.entries(serverEnv())) {
  process.env[name] ??= value;
}

await import("../src/main.ts");
