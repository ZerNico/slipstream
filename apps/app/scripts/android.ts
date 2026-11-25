/**
 * Shared helpers for the app's device scripts (`tv.ts`, `dev-client.ts`): the Android toolchain
 * environment (what `scripts/android-env.sh` sets, so nobody has to source it first) and adb.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `apps/app`. */
export const appRoot: string = dirname(dirname(fileURLToPath(import.meta.url)));

/** The Android package id from app.json. */
export const packageId = "dev.slipstream.app";

/** Port Metro serves the JS bundle on; debug builds load it from there. */
export const metroPort = 8081;

const macJdk = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";

/** `process.env` plus JAVA_HOME, ANDROID_HOME and platform-tools on PATH, unless already set. */
export const androidEnv = (env = process.env): NodeJS.ProcessEnv => {
  const javaHome = env["JAVA_HOME"] ?? (existsSync(macJdk) ? macJdk : undefined);
  const androidHome =
    env["ANDROID_HOME"] ??
    join(homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");
  const path = [
    ...(javaHome === undefined ? [] : [join(javaHome, "bin")]),
    join(androidHome, "platform-tools"),
    env["PATH"] ?? "",
  ].join(delimiter);
  return {
    ...env,
    ...(javaHome === undefined ? {} : { JAVA_HOME: javaHome }),
    ANDROID_HOME: androidHome,
    PATH: path,
  };
};

/** Runs a command with output shown; exits with a hint when it fails. */
export const run = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnSyncOptions & { readonly hint?: string } = {},
): void => {
  const result = spawnSync(command, args, { stdio: "inherit", env: androidEnv(), ...options });
  if (result.status === 0) return;
  console.error(`\n${command} ${args.join(" ")} failed.${options.hint ? `\n${options.hint}` : ""}`);
  process.exit(result.status ?? 1);
};

/** Runs adb and returns its output (stdout and stderr). */
export const adb = (args: ReadonlyArray<string>): { ok: boolean; output: string } => {
  const result = spawnSync("adb", args, { encoding: "utf8", env: androidEnv() });
  if (result.error !== undefined) {
    console.error(
      "adb not found. Install the Android SDK platform-tools (pnpm run doctor shows how).",
    );
    process.exit(1);
  }
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
};

/** How to switch on network debugging, for when no device address is given or it is refused. */
export const networkDebuggingHelp = `Enable network debugging on the TV once:
  1. Settings > Device Preferences > About: select "Build" 7 times (developer options appear).
  2. Settings > Device Preferences > Developer options: turn on "Network debugging"
     (Shield) or "Wireless debugging" (Google TV). Note the address shown, e.g. 192.168.12.50:5555.
  3. Google TV only: pair first with  adb pair <address shown under "Pair device"> <code>.
Then run:  SHIELD_ADDRESS=192.168.12.50:5555 pnpm app:tv
The first connection shows "Allow USB debugging?" on the TV: choose "Always allow".`;

/** Connects to a network device and fails with instructions when it cannot. */
export const connect = (address: string): void => {
  const connected = adb(["connect", address]);
  const state = adb(["-s", address, "get-state"]);
  if (state.ok && state.output === "device") return;
  console.error(
    `Could not reach ${address} over adb (${connected.output || state.output}).\n` +
      (state.output.includes("unauthorized")
        ? 'Accept "Allow USB debugging?" on the TV, then run this again.'
        : networkDebuggingHelp),
  );
  process.exit(1);
};

/** The first non-internal IPv4 address of this machine, which a TV on the LAN can reach. */
export const lanAddress = (): string | undefined =>
  Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry !== undefined && entry.family === "IPv4" && !entry.internal)?.address;
