/**
 * Per-checkout development state, shared by `pnpm dev`, the server's dev entry and the web app's
 * Vite config. Every checkout (worktrees included) gets its own ports and its own `.data/dev`, so
 * several can run at once without stepping on each other. Nothing here is read in production.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root of the checkout this file lives in. */
export const repoRoot: string = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));

/** The three ports a dev instance listens on. */
export interface DevPorts {
  /** Vite with HMR; proxies /api and /hls to the server. Open this one. */
  readonly web: number;
  /** The Slipstream server (API, HLS). */
  readonly server: number;
  /** The fake IPTV source (M3U, XMLTV, test streams). */
  readonly source: number;
}

/** Where a checkout keeps its dev state. */
export interface DevPaths {
  /** Short hash of the checkout path; stable across branch switches. */
  readonly id: string;
  /** `.data/dev` of the checkout. */
  readonly directory: string;
  /** The server's SQLite database and `secret.key`. */
  readonly configDir: string;
  /** The segment store. */
  readonly dataDir: string;
  /** `instance.json`: the dev admin's credentials and whether the seed ran. */
  readonly stateFile: string;
}

/** The dev admin account `pnpm dev` creates on first start. Dev only, never in production. */
export interface DevAdmin {
  readonly username: string;
  readonly password: string;
}

/** What `instance.json` holds. */
export interface DevState {
  readonly id: string;
  readonly admin: DevAdmin;
  /** When the first-start seed finished; absent until then. */
  readonly seededAt?: string;
}

const checkoutId = (root: string): string =>
  createHash("sha256").update(root).digest("hex").slice(0, 12);

/**
 * Ports from a hash of the checkout path: four consecutive ports starting somewhere in
 * 20000-29996, so two checkouts collide only by bad luck (then set `SLIPSTREAM_DEV_PORT`).
 * `SLIPSTREAM_DEV_PORT` picks the first port by hand.
 */
export const devPorts = (root: string = repoRoot, env = process.env): DevPorts => {
  const override = env["SLIPSTREAM_DEV_PORT"];
  const base =
    override !== undefined && /^\d+$/u.test(override)
      ? Number(override)
      : 20_000 + (Number.parseInt(checkoutId(root).slice(0, 8), 16) % 2500) * 4;
  return { web: base, server: base + 1, source: base + 2 };
};

/** The dev state paths of a checkout. */
export const devPaths = (root: string = repoRoot): DevPaths => {
  const directory = join(root, ".data", "dev");
  return {
    id: checkoutId(root),
    directory,
    configDir: join(directory, "config"),
    dataDir: join(directory, "data"),
    stateFile: join(directory, "instance.json"),
  };
};

const isState = (value: unknown, id: string): value is DevState => {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<DevState>;
  return (
    state.id === id &&
    typeof state.admin?.username === "string" &&
    typeof state.admin.password === "string"
  );
};

/** Reads this checkout's dev state, or `undefined` before the first `pnpm dev`. */
export const readDevState = (paths: DevPaths = devPaths()): DevState | undefined => {
  let raw: string;
  try {
    raw = readFileSync(paths.stateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isState(parsed, paths.id)) {
    throw new Error(
      `${paths.stateFile} belongs to another checkout or is damaged. Run pnpm dev:reset.`,
    );
  }
  return parsed;
};

/** Writes the dev state, readable by the owner only (it holds the dev admin's password). */
export const writeDevState = (state: DevState, paths: DevPaths = devPaths()): void => {
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
};

/** Reads the dev state, creating it with fresh dev admin credentials on first use. */
export const loadOrCreateDevState = (paths: DevPaths = devPaths()): DevState => {
  const existing = readDevState(paths);
  if (existing !== undefined) return existing;
  const state: DevState = {
    id: paths.id,
    admin: { username: "dev", password: randomBytes(12).toString("base64url") },
  };
  writeDevState(state, paths);
  return state;
};

/**
 * The `SLIPSTREAM_*` variables the server runs with in dev: this checkout's ports and data
 * directories, loopback only and silent on mDNS (with `lan`: all interfaces and announced, so
 * the TV app finds it), and a small free-space floor so a laptop disk never triggers the guard.
 */
export const serverEnv = (
  options: { readonly root?: string; readonly lan?: boolean } = {},
): Record<string, string> => {
  const root = options.root ?? repoRoot;
  const ports = devPorts(root);
  const paths = devPaths(root);
  return {
    SLIPSTREAM_HOST: options.lan === true ? "0.0.0.0" : "127.0.0.1",
    SLIPSTREAM_PORT: String(ports.server),
    SLIPSTREAM_CONFIG_DIR: paths.configDir,
    SLIPSTREAM_DATA_DIR: paths.dataDir,
    SLIPSTREAM_MDNS: options.lan === true ? "true" : "false",
    SLIPSTREAM_FREE_SPACE_FLOOR_GB: "1",
  };
};
