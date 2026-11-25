/**
 * `pnpm app:tv`: builds the debug APK for arm64-v8a (Shield, Google TV, Fire TV), installs it on
 * an Android TV over network adb and starts it. `SHIELD_ADDRESS` names the device, e.g.
 * `192.168.12.50:5555`. A debug build loads its JavaScript from Metro, so the TV's port 8081 is
 * forwarded to this machine; run `pnpm app:dev` for Metro. `--skip-build` installs the last APK.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  adb,
  appRoot,
  connect,
  metroPort,
  networkDebuggingHelp,
  packageId,
  run,
} from "./android.ts";

const address = process.env["SHIELD_ADDRESS"];
if (address === undefined || address === "") {
  console.error(`Set SHIELD_ADDRESS to the TV's adb address.\n\n${networkDebuggingHelp}`);
  process.exit(1);
}

const android = join(appRoot, "android");
const apk = join(android, "app", "build", "outputs", "apk", "debug", "app-debug.apk");

connect(address);

if (!process.argv.includes("--skip-build")) {
  if (!existsSync(android)) {
    console.log("Generating the native Android project (expo prebuild, TV flavour)...");
    run("pnpm", ["run", "prebuild"], { cwd: appRoot });
  }
  console.log("Building the debug APK for arm64-v8a...");
  run("./gradlew", ["assembleDebug", "-PreactNativeArchitectures=arm64-v8a"], {
    cwd: android,
    hint: "pnpm run doctor checks JDK 17 and the Android SDK.",
  });
}

if (!existsSync(apk)) {
  console.error(`No APK at ${apk}. Run without --skip-build first.`);
  process.exit(1);
}

console.log(`Installing on ${address}...`);
run("adb", ["-s", address, "install", "-r", apk]);
const reverse = adb(["-s", address, "reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
if (!reverse.ok) console.warn(`adb reverse failed (${reverse.output}); Metro may be unreachable.`);
run("adb", [
  "-s",
  address,
  "shell",
  "monkey",
  "-p",
  packageId,
  "-c",
  "android.intent.category.LEANBACK_LAUNCHER",
  "1",
]);
console.log(
  `\nSlipstream is starting on ${address}. It loads its JavaScript from Metro: run pnpm app:dev if it is not running yet.`,
);
