/**
 * The development runner behind `pnpm dev`, `dev:mock`, `dev:reset` and `dev:info`.
 *
 * `pnpm dev` starts the fake source, the server (restarted by `node --watch` on change) and the
 * web app (Vite with HMR, proxying /api and /hls to the server), prefixes and colours their logs,
 * seeds a fresh checkout and prints where everything is. Ctrl+C stops all of it, ffmpeg included
 * (see `processes.ts`). Ports and `.data/dev` are per checkout (see `dev-state.ts`).
 */
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { seed } from "./dev-seed.ts";
import {
  devPaths,
  devPorts,
  type DevPorts,
  type DevState,
  loadOrCreateDevState,
  readDevState,
  repoRoot,
  serverEnv,
  writeDevState,
} from "./dev-state.ts";
import { ffmpegBinaries, quickChecks, report } from "./doctor.ts";
import { answers, paint, Supervisor, tag, waitFor } from "./processes.ts";

const say = (text: string): void => console.log(`${tag("dev", "yellow")} ${text}`);

/** Stops every child and exits; Ctrl+C and a crashed child both end here. */
const shutdown = async (code: number): Promise<void> => {
  if (supervisor.stopping) return;
  if (supervisor.size > 0) say("Stopping...");
  await supervisor.stopAll();
  process.exit(code);
};

const supervisor = new Supervisor((name, reason) => {
  say(paint("red", `${name} ${reason}; stopping everything.`));
  void shutdown(1);
});

/** Whether nothing listens on the port. */
const portFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      probe.close(() => resolve(true)),
    );
  });

const urls = (ports: DevPorts) => ({
  web: `http://127.0.0.1:${ports.web}`,
  server: `http://127.0.0.1:${ports.server}`,
  source: `http://127.0.0.1:${ports.source}`,
});

/** The first non-internal IPv4 address, for `--lan`. */
const lanAddress = (): string | undefined =>
  Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry !== undefined && entry.family === "IPv4" && !entry.internal)?.address;

/** The web app's Vite, run with this Node (no pnpm wrapper between us and it). */
const viteBin = join(repoRoot, "apps", "web", "node_modules", "vite", "bin", "vite.js");

const startWeb = (ports: DevPorts, env: Record<string, string>): void => {
  supervisor.start("web", "green", process.execPath, [viteBin, "dev", "--clearScreen", "false"], {
    cwd: join(repoRoot, "apps", "web"),
    env: { PORT: String(ports.web), ...env },
  });
};

const failIfBusy = async (ports: DevPorts, names: ReadonlyArray<keyof DevPorts>) => {
  // This checkout's own server answering means a second `pnpm dev`, not a stranger on the port.
  if (await answers(`${urls(ports).server}/api/health`)) {
    throw new Error("pnpm dev already runs in this checkout. pnpm dev:info shows where.");
  }
  for (const name of names) {
    if (await portFree(ports[name])) continue;
    throw new Error(
      `Port ${ports[name]} (${name}) is taken by another program. Pick other ports with SLIPSTREAM_DEV_PORT=<first port> pnpm dev.`,
    );
  }
};

const printBanner = (ports: DevPorts, state: DevState, lan: boolean): void => {
  const at = urls(ports);
  const lines = [
    "",
    paint("bold", "Slipstream is running"),
    `  Web app      ${paint("cyan", at.web)}   ${paint("dim", "(open this one)")}`,
    `  Server API   ${at.server}`,
    `  Fake source  ${at.source}/playlist.m3u`,
    `  Sign in      ${paint("bold", state.admin.username)} / ${paint("bold", state.admin.password)}   ${paint("dim", "(dev only)")}`,
    `  Data         ${devPaths().directory}`,
  ];
  const address = lan ? lanAddress() : undefined;
  if (address !== undefined) {
    lines.push(
      `  On the LAN   http://${address}:${ports.server}   ${paint("dim", "(for the app)")}`,
    );
  }
  lines.push(paint("dim", "  Ctrl+C stops everything. pnpm dev:info prints this again."), "");
  for (const line of lines) console.log(line);
};

const runDev = async (lan: boolean): Promise<void> => {
  const checks = quickChecks();
  if (checks.some((check) => check.status === "fail")) {
    console.error(paint("bold", "pnpm dev cannot start yet:"));
    report(checks, { onlyProblems: true });
    console.error("\nFix the above, then run pnpm dev again. pnpm run doctor checks everything.");
    process.exitCode = 1;
    return;
  }
  report(checks, { onlyProblems: true });

  const ports = devPorts();
  await failIfBusy(ports, ["web", "server", "source"]);
  const state = loadOrCreateDevState();
  const at = urls(ports);
  const cancelled = () => supervisor.stopping;

  supervisor.start("source", "magenta", process.execPath, [
    join(repoRoot, "tools", "fake-source", "src", "bin", "fake-source.ts"),
    "--port",
    String(ports.source),
    "--duplicates",
    "--ffmpeg",
    ffmpegBinaries().ffmpeg,
  ]);
  supervisor.start(
    "server",
    "cyan",
    process.execPath,
    ["--watch", "--watch-preserve-output", join("apps", "server", "scripts", "dev.ts")],
    { env: serverEnv({ lan }) },
  );
  startWeb(ports, {
    SLIPSTREAM_SERVER_URL: at.server,
    ...(lan ? { SLIPSTREAM_DEV_HOST: "0.0.0.0" } : {}),
  });

  await waitFor(`${at.source}/playlist.m3u`, 30_000, cancelled);
  await waitFor(`${at.server}/api/health`, 90_000, cancelled);
  if (state.seededAt === undefined) {
    say("First start: creating the dev admin, adding and refreshing the fake source...");
    const summary = await seed({ serverUrl: at.server, sourceUrl: at.source, admin: state.admin });
    writeDevState({ ...state, seededAt: new Date().toISOString() });
    say(
      `Seeded: ${summary.channels} channels, ${summary.programmes} programmes, rule "${summary.rule}", collection "${summary.collection}".`,
    );
  }
  await waitFor(at.web, 60_000, cancelled);
  printBanner(ports, state, lan);
};

const runMock = async (): Promise<void> => {
  const ports = devPorts();
  await failIfBusy(ports, ["web"]);
  startWeb(ports, { SLIPSTREAM_MOCK: "1" });
  await waitFor(`http://127.0.0.1:${ports.web}`, 60_000, () => supervisor.stopping);
  console.log(
    `\n${paint("bold", "Slipstream web app on the mock API")}\n  ${paint("cyan", `http://127.0.0.1:${ports.web}`)}   ${paint("dim", "(signed in as the mock admin; no server)")}\n`,
  );
};

const runInfo = async (): Promise<void> => {
  const ports = devPorts();
  const at = urls(ports);
  const state = readDevState();
  const running = await answers(`${at.server}/api/health`);
  console.log(
    [
      paint("bold", `Slipstream dev instance ${devPaths().id}`),
      `  Status       ${running ? paint("green", "running") : "not running (pnpm dev starts it)"}`,
      `  Web app      ${at.web}`,
      `  Server API   ${at.server}`,
      `  Fake source  ${at.source}/playlist.m3u`,
      `  Sign in      ${state === undefined ? "created on the first pnpm dev" : `${state.admin.username} / ${state.admin.password}`}`,
      `  Data         ${devPaths().directory}`,
    ].join("\n"),
  );
};

const runReset = async (yes: boolean): Promise<void> => {
  const ports = devPorts();
  if (await answers(`${urls(ports).server}/api/health`)) {
    throw new Error("pnpm dev is running in this checkout. Stop it first (Ctrl+C).");
  }
  const { directory } = devPaths();
  if (!yes) {
    if (!process.stdin.isTTY) {
      throw new Error("pnpm dev:reset needs a terminal to confirm, or --yes: pnpm dev:reset --yes");
    }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(
      `Delete ${directory} (database, recordings, dev login)? [y/N] `,
    );
    prompt.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Nothing deleted.");
      return;
    }
  }
  rmSync(directory, { recursive: true, force: true });
  console.log(`Deleted ${directory}. The next pnpm dev starts fresh and seeds again.`);
};

const main = async (): Promise<void> => {
  // `pnpm dev --lan` arrives as `dev.ts --lan`, `pnpm dev:reset --yes` as `dev.ts reset --yes`.
  const flags = process.argv.slice(2);
  const command = flags.find((arg) => !arg.startsWith("-")) ?? "start";
  switch (command) {
    case "start":
      return runDev(flags.includes("--lan"));
    case "mock":
      return runMock();
    case "info":
      return runInfo();
    case "reset":
      return runReset(flags.includes("--yes"));
    default:
      throw new Error(
        `Unknown command "${command}". Use pnpm dev, dev:mock, dev:info or dev:reset.`,
      );
  }
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => void shutdown(0));
}
main().catch((error: unknown) => {
  if (supervisor.stopping) return;
  console.error(`\n${paint("red", error instanceof Error ? error.message : String(error))}`);
  void shutdown(1);
});
