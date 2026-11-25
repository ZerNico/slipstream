/**
 * `pnpm app:dev`: Metro for the debug build on a phone or TV, pointed at this checkout's dev
 * server. Prints the server address to add in the app (or it is discovered over mDNS when
 * `pnpm dev --lan` runs), forwards Metro's port to `SHIELD_ADDRESS` when set, then runs
 * `expo start` in the foreground.
 */
import { spawn } from "node:child_process";
import { devPorts } from "../../../scripts/dev-state.ts";
import { adb, androidEnv, appRoot, connect, lanAddress, metroPort } from "./android.ts";

const ports = devPorts();
const host = lanAddress();
const serverUrl = host === undefined ? undefined : `http://${host}:${ports.server}`;

const reachable = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
};

if (serverUrl === undefined) {
  console.warn("No network address found: a phone or TV cannot reach this machine.");
} else if (await reachable(serverUrl)) {
  console.log(
    `Dev server for the app: ${serverUrl}\n(it is announced over mDNS too, so "Find servers" lists it)`,
  );
} else {
  console.warn(
    `The dev server is not reachable at ${serverUrl}.\nRun pnpm dev --lan in another terminal: it listens on the network and announces itself.`,
  );
}

const address = process.env["SHIELD_ADDRESS"];
if (address !== undefined && address !== "") {
  connect(address);
  adb(["-s", address, "reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
  console.log(`Forwarded port ${metroPort} on ${address} to Metro here.`);
}

const expo = spawn("pnpm", ["exec", "expo", "start", "--port", String(metroPort)], {
  cwd: appRoot,
  stdio: "inherit",
  env: { ...androidEnv(), EXPO_TV: "1" },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => expo.kill(signal));
}
expo.on("exit", (code) => process.exit(code ?? 0));
