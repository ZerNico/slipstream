/**
 * `pnpm e2e`: the web journey (apps/web/e2e) against a fresh, production-like server: builds the
 * web app, starts the fake source and a server serving `apps/web/dist` from a temporary data
 * directory, runs Playwright with `SLIPSTREAM_E2E_URL`, then stops everything and deletes the
 * data. CI runs exactly this. `--skip-build` reuses the last build; `--keep` keeps the data.
 * Every other argument goes to Playwright: `pnpm e2e --skip-build shell.spec.ts` runs one spec,
 * `pnpm e2e --project=layout --shard=1/2` one of CI's four shards (.github/workflows/ci.yml).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "./dev-state.ts";
import { ffmpegBinaries } from "./doctor.ts";
import { paint, Supervisor, tag, waitFor } from "./processes.ts";

const say = (text: string): void => console.log(`${tag("e2e", "blue")} ${text}`);

/** A port nothing listens on right now. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ port: 0, host: "127.0.0.1" }, () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

const ownFlags = new Set(["--skip-build", "--keep"]);
const flags = new Set(process.argv.slice(2));
/** What Playwright gets: spec files, `--grep`, `--project` and the like. */
const playwrightArgs = process.argv.slice(2).filter((arg) => !ownFlags.has(arg));
const dataRoot = mkdtempSync(join(tmpdir(), "slipstream-e2e-"));
let failure: string | undefined;
const supervisor = new Supervisor((name, reason) => {
  failure = `${name} ${reason}`;
  say(paint("red", failure));
});

const finish = async (code: number): Promise<never> => {
  await supervisor.stopAll();
  if (flags.has("--keep")) say(`Data kept in ${dataRoot}`);
  else rmSync(dataRoot, { recursive: true, force: true });
  process.exit(code);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void finish(130));
}

const main = async (): Promise<number> => {
  if (!flags.has("--skip-build")) {
    say("Building the web app...");
    const build = spawnSync("pnpm", ["--filter", "@slipstream/web", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (build.status !== 0) return build.status ?? 1;
  }

  const [serverPort, sourcePort] = [await freePort(), await freePort()];
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const sourceUrl = `http://127.0.0.1:${sourcePort}`;
  const { ffmpeg } = ffmpegBinaries();
  supervisor.start("source", "magenta", process.execPath, [
    join("tools", "fake-source", "src", "bin", "fake-source.ts"),
    "--port",
    String(sourcePort),
    "--ffmpeg",
    ffmpeg,
  ]);
  supervisor.start("server", "cyan", process.execPath, [join("apps", "server", "src", "main.ts")], {
    env: {
      SLIPSTREAM_HOST: "127.0.0.1",
      SLIPSTREAM_PORT: String(serverPort),
      SLIPSTREAM_CONFIG_DIR: join(dataRoot, "config"),
      SLIPSTREAM_DATA_DIR: join(dataRoot, "data"),
      SLIPSTREAM_WEB_DIR: join(repoRoot, "apps", "web", "dist"),
      SLIPSTREAM_MDNS: "false",
      SLIPSTREAM_FREE_SPACE_FLOOR_GB: "1",
    },
  });
  const cancelled = () => failure !== undefined;
  await waitFor(`${sourceUrl}/playlist.m3u`, 30_000, cancelled);
  await waitFor(`${serverUrl}/api/health`, 60_000, cancelled);
  say(`Server ${serverUrl}, fake source ${sourceUrl}, data ${dataRoot}`);

  const playwright = spawn("pnpm", ["--filter", "@slipstream/web", "e2e", ...playwrightArgs], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, SLIPSTREAM_E2E_URL: serverUrl, SLIPSTREAM_E2E_SOURCE_URL: sourceUrl },
  });
  const code = await new Promise<number>((resolve) =>
    playwright.once("exit", (exit) => resolve(exit ?? 1)),
  );
  return failure === undefined ? code : 1;
};

main().then(
  (code) => finish(code),
  (error: unknown) => {
    say(paint("red", error instanceof Error ? error.message : String(error)));
    return finish(1);
  },
);
