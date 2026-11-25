/**
 * `pnpm doctor`: checks that this machine can build and run Slipstream, and prints the exact
 * command that fixes each problem. `pnpm dev` runs the quick checks first (`--quick`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";
import {
  majorOf,
  MIN_FFMPEG_MAJOR,
  parseVersion,
  siblingFfprobe,
} from "../packages/recorder/src/capture/binaries.ts";
import { androidEnv } from "../apps/app/scripts/android.ts";
import { repoRoot } from "./dev-state.ts";

/** `fail` stops `pnpm dev`; `warn` is worth knowing but does not block. */
export type Status = "ok" | "warn" | "fail";

/** The outcome of one check. */
export interface CheckResult {
  readonly name: string;
  readonly status: Status;
  /** What was found, e.g. "26.13.1" or "not found". */
  readonly detail: string;
  /** Why it matters, for warnings and failures. */
  readonly why?: string;
  /** The command (or step) that fixes it. */
  readonly fix?: string;
}

const isMac = process.platform === "darwin";
const GB = 1024 ** 3;

/** Runs a binary and returns its combined output, or `undefined` when it cannot start. */
const capture = (binary: string, args: ReadonlyArray<string>, cwd?: string): string | undefined => {
  const result = spawnSync(binary, args, { encoding: "utf8", cwd, timeout: 15_000 });
  if (result.error !== undefined || result.status !== 0) return undefined;
  return `${result.stdout}${result.stderr}`;
};

/** The Node major version `.node-version` asks for. */
export const requiredNodeMajor = (root: string = repoRoot): number =>
  Number.parseInt(readFileSync(join(root, ".node-version"), "utf8").trim(), 10);

const checkNode = (): CheckResult => {
  const wanted = requiredNodeMajor();
  const current = process.versions.node;
  const major = Number.parseInt(current, 10);
  if (major === wanted) return { name: "Node", status: "ok", detail: current };
  return {
    name: "Node",
    // Newer usually works; older lacks what the repository relies on (type stripping, node:sqlite).
    status: major > wanted ? "warn" : "fail",
    detail: `${current}, this repository uses ${wanted} (.node-version)`,
    fix: `install Node ${wanted} (https://nodejs.org or your version manager; it reads .node-version)`,
  };
};

const wantedPnpm = (): string => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    packageManager?: string;
  };
  return manifest.packageManager?.replace(/^pnpm@/u, "") ?? "12";
};

const checkPnpm = (): CheckResult => {
  const wanted = wantedPnpm();
  // Under `pnpm doctor` the running pnpm names itself; otherwise ask the one on PATH.
  const agent = /pnpm\/(\d+\.\d+\.\d+)/u.exec(process.env["npm_config_user_agent"] ?? "")?.[1];
  const current = agent ?? capture("pnpm", ["--version"])?.trim();
  const fix = "npm install --global corepack@latest && corepack enable";
  if (current === undefined) {
    return { name: "pnpm", status: "fail", detail: "not found", fix };
  }
  return current.split(".")[0] === wanted.split(".")[0]
    ? { name: "pnpm", status: "ok", detail: current }
    : {
        name: "pnpm",
        status: "fail",
        detail: `${current}, this repository pins ${wanted} (packageManager)`,
        why: "corepack runs the pinned pnpm for you once it is enabled.",
        fix,
      };
};

const ffmpegFix = isMac
  ? "brew install ffmpeg"
  : `install ffmpeg ${MIN_FFMPEG_MAJOR} or newer (Debian and Ubuntu ship older ones; https://ffmpeg.org/download.html lists static builds), or set SLIPSTREAM_FFMPEG / SLIPSTREAM_FFPROBE to its path`;

const checkFfTool = (name: "ffmpeg" | "ffprobe", binary: string): CheckResult => {
  const output = capture(binary, ["-version"]);
  if (output === undefined) {
    return {
      name,
      status: "fail",
      detail: `${binary} not found`,
      why: "Captures, recordings and the fake source all run ffmpeg.",
      fix: ffmpegFix,
    };
  }
  const version = parseVersion(output);
  if (version === null) {
    return {
      name,
      status: "warn",
      detail: `version not recognised (${output.split("\n")[0] ?? ""})`,
      why: `Slipstream needs ffmpeg ${MIN_FFMPEG_MAJOR} or newer and could not tell which this is.`,
    };
  }
  return majorOf(version) >= MIN_FFMPEG_MAJOR
    ? { name, status: "ok", detail: version }
    : {
        name,
        status: "fail",
        detail: `${version}, Slipstream needs ${MIN_FFMPEG_MAJOR} or newer`,
        why: "The server's startup self-check fails on older ones: what it reads from ffmpeg is tested with 8 and 9 only.",
        fix: ffmpegFix,
      };
};

/** The ffmpeg and ffprobe binaries the server and fake source use (`SLIPSTREAM_FFMPEG` etc.). */
export const ffmpegBinaries = (env = process.env) => {
  const ffmpeg = env["SLIPSTREAM_FFMPEG"] ?? "ffmpeg";
  const ffprobe = env["SLIPSTREAM_FFPROBE"] ?? siblingFfprobe(ffmpeg);
  return { ffmpeg, ffprobe };
};

const checkDrawtext = (ffmpeg: string): CheckResult | undefined => {
  const filters = capture(ffmpeg, ["-hide_banner", "-filters"]);
  if (filters === undefined) return undefined;
  return /\bdrawtext\b/u.test(filters)
    ? { name: "ffmpeg drawtext", status: "ok", detail: "available" }
    : {
        name: "ffmpeg drawtext",
        status: "warn",
        detail: "missing (ffmpeg was built without libfreetype)",
        why: "The fake source still works, but its test streams show no channel name or clock.",
        fix: isMac
          ? 'brew install ffmpeg-full && export SLIPSTREAM_FFMPEG="$(brew --prefix ffmpeg-full)/bin/ffmpeg"'
          : "install an ffmpeg build with libfreetype (most distribution and static builds have it)",
      };
};

const checkDisk = (): CheckResult => {
  const stats = statfsSync(repoRoot);
  const free = stats.bavail * stats.bsize;
  const detail = `${(free / GB).toFixed(1)} GB free`;
  const fix = "free some space, or run pnpm dev:reset to drop this checkout's dev recordings";
  if (free < 2 * GB) {
    return {
      name: "Disk space",
      status: "fail",
      detail,
      why: "Recordings take 3-4 GB per hour.",
      fix,
    };
  }
  return free < 10 * GB
    ? { name: "Disk space", status: "warn", detail, why: "Recordings take 3-4 GB per hour.", fix }
    : { name: "Disk space", status: "ok", detail };
};

/** The SDK the app's device scripts use (their `androidEnv`, so doctor checks the same one). */
const androidHome = (): string => androidEnv()["ANDROID_HOME"] ?? "";

const javaHome = (): string | undefined => androidEnv()["JAVA_HOME"];

const checkJdk = (): CheckResult => {
  const home = javaHome();
  const java = home === undefined ? "java" : join(home, "bin", "java");
  const output = capture(java, ["-version"]);
  const major = output === undefined ? undefined : /version "(\d+)/u.exec(output)?.[1];
  const fix = isMac
    ? "brew install openjdk@17, then source scripts/android-env.sh"
    : "install JDK 17 and set JAVA_HOME";
  if (major === undefined) {
    return { name: "JDK 17 (app)", status: "warn", detail: "not found", fix };
  }
  return major === "17"
    ? { name: "JDK 17 (app)", status: "ok", detail: `${major} at ${home ?? "PATH"}` }
    : {
        name: "JDK 17 (app)",
        status: "warn",
        detail: `JDK ${major}; React Native's Gradle build wants 17`,
        fix,
      };
};

const checkAndroidSdk = (): CheckResult => {
  const home = androidHome();
  return existsSync(join(home, "platforms"))
    ? { name: "Android SDK (app)", status: "ok", detail: home }
    : {
        name: "Android SDK (app)",
        status: "warn",
        detail: `not found at ${home}`,
        fix: "install Android Studio (SDK Manager: Android SDK Platform 36, NDK) or set ANDROID_HOME",
      };
};

const checkAdb = (): CheckResult => {
  const bundled = join(androidHome(), "platform-tools", "adb");
  const version = capture("adb", ["version"]) ?? capture(bundled, ["version"]);
  const found = /Android Debug Bridge version ([\d.]+)/u.exec(version ?? "")?.[1];
  return found === undefined
    ? {
        name: "adb (app)",
        status: "warn",
        detail: "not found",
        fix: isMac
          ? "source scripts/android-env.sh (adds the SDK's platform-tools), or brew install --cask android-platform-tools"
          : "install the Android platform-tools and add them to PATH",
      }
    : { name: "adb (app)", status: "ok", detail: found };
};

const checkPlaywright = (): CheckResult => {
  const web = join(repoRoot, "apps", "web");
  const fix = "pnpm --filter @slipstream/web exec playwright install chromium";
  const output = capture(join(web, "node_modules", ".bin", "playwright"), [
    "install",
    "--dry-run",
    "chromium",
  ]);
  if (output === undefined) {
    return {
      name: "Playwright chromium (e2e)",
      status: "warn",
      detail: "playwright not installed",
      fix: "pnpm install",
    };
  }
  // The dry run lists chromium and its headless shell first; both must be there.
  const locations = [...output.matchAll(/Install location:\s+(\S+chromium\S*)/gu)].map(
    (match) => match[1] ?? "",
  );
  const missing = locations.filter((location) => !existsSync(location));
  return locations.length > 0 && missing.length === 0
    ? { name: "Playwright chromium (e2e)", status: "ok", detail: "installed" }
    : { name: "Playwright chromium (e2e)", status: "warn", detail: "not installed", fix };
};

const checkDocker = (): CheckResult => {
  const version = capture("docker", ["version", "--format", "{{.Server.Version}}"])?.trim();
  return version === undefined
    ? {
        name: "Docker (image)",
        status: "warn",
        detail: "not running or not installed",
        fix: "install Docker Desktop or OrbStack, and start it",
      }
    : { name: "Docker (image)", status: "ok", detail: version };
};

/** The checks `pnpm dev` needs: toolchain and ffmpeg. Fast (a few process spawns). */
export const quickChecks = (): Array<CheckResult> => {
  const { ffmpeg, ffprobe } = ffmpegBinaries();
  const results = [
    checkNode(),
    checkFfTool("ffmpeg", ffmpeg),
    checkFfTool("ffprobe", ffprobe),
    checkDisk(),
  ];
  const drawtext = checkDrawtext(ffmpeg);
  return drawtext === undefined ? results : [...results, drawtext];
};

/** Every check: the quick ones, pnpm, and the optional tools for app, e2e and image work. */
export const allChecks = (): Array<CheckResult> => [
  ...quickChecks().flatMap((check) => (check.name === "Node" ? [check, checkPnpm()] : [check])),
  checkJdk(),
  checkAndroidSdk(),
  checkAdb(),
  checkPlaywright(),
  checkDocker(),
];

const marks: Record<Status, string> = {
  ok: styleText("green", "ok  "),
  warn: styleText("yellow", "warn"),
  fail: styleText("red", "FAIL"),
};

/** Prints results, one line each, with why and fix under anything that is not ok. */
export const report = (results: ReadonlyArray<CheckResult>, options = { onlyProblems: false }) => {
  for (const result of results) {
    if (options.onlyProblems && result.status === "ok") continue;
    console.log(`  ${marks[result.status]}  ${result.name}: ${result.detail}`);
    if (result.status === "ok") continue;
    if (result.why !== undefined) console.log(`        ${styleText("dim", result.why)}`);
    if (result.fix !== undefined) console.log(`        fix: ${styleText("cyan", result.fix)}`);
  }
};

const main = () => {
  const quick = process.argv.includes("--quick");
  console.log(styleText("bold", quick ? "Slipstream doctor (quick)" : "Slipstream doctor"));
  const results = quick ? quickChecks() : allChecks();
  report(results);
  const failed = results.filter((result) => result.status === "fail").length;
  const warned = results.filter((result) => result.status === "warn").length;
  console.log(
    failed > 0
      ? styleText("red", `\n${failed} problem(s) to fix before pnpm dev.`)
      : warned > 0
        ? `\nReady for pnpm dev. ${warned} warning(s): optional tools, or things worth knowing.`
        : "\nAll good.",
  );
  if (failed > 0) process.exitCode = 1;
};

if (import.meta.main) main();
