import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { devPaths, devPorts, loadOrCreateDevState, readDevState, serverEnv } from "./dev-state.ts";

const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "slipstream-dev-state-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

describe("devPorts", () => {
  it("is stable for a checkout and differs between checkouts", () => {
    const main = devPorts("/work/slipstream", {});
    expect(devPorts("/work/slipstream", {})).toEqual(main);
    expect(devPorts("/work/slipstream/.claude/worktrees/track", {}).web).not.toBe(main.web);
  });

  it("hands out three consecutive ports in 20000-29999", () => {
    for (const root of ["/a", "/b", "/c/d", "/Users/someone/Developer/slipstream"]) {
      const ports = devPorts(root, {});
      expect(ports.web).toBeGreaterThanOrEqual(20_000);
      expect(ports.source).toBeLessThanOrEqual(29_999);
      expect(ports).toEqual({ web: ports.web, server: ports.web + 1, source: ports.web + 2 });
    }
  });

  it("takes the first port from SLIPSTREAM_DEV_PORT", () => {
    expect(devPorts("/a", { SLIPSTREAM_DEV_PORT: "4100" })).toEqual({
      web: 4100,
      server: 4101,
      source: 4102,
    });
  });
});

describe("dev state", () => {
  it("creates dev credentials once, readable by the owner only", () => {
    const paths = devPaths(tempRoot());
    expect(readDevState(paths)).toBeUndefined();

    const created = loadOrCreateDevState(paths);
    expect(created.admin.username).toBe("dev");
    // The server's minimum password length is 10.
    expect(created.admin.password.length).toBeGreaterThanOrEqual(10);
    expect(statSync(paths.stateFile).mode & 0o777).toBe(0o600);
    expect(loadOrCreateDevState(paths)).toEqual(created);
  });

  it("refuses state copied from another checkout", () => {
    const original = devPaths(tempRoot());
    loadOrCreateDevState(original);
    const copy = { ...devPaths(tempRoot()), stateFile: original.stateFile };
    expect(() => readDevState(copy)).toThrow(/another checkout/u);
  });

  it("points the server at this checkout's port and .data/dev, loopback only", () => {
    const env = serverEnv({ root: "/work/slipstream" });
    expect(env).toMatchObject({
      SLIPSTREAM_PORT: String(devPorts("/work/slipstream").server),
      SLIPSTREAM_HOST: "127.0.0.1",
      SLIPSTREAM_CONFIG_DIR: "/work/slipstream/.data/dev/config",
      SLIPSTREAM_DATA_DIR: "/work/slipstream/.data/dev/data",
      SLIPSTREAM_MDNS: "false",
    });
    expect(serverEnv({ root: "/work/slipstream", lan: true })).toMatchObject({
      SLIPSTREAM_HOST: "0.0.0.0",
      SLIPSTREAM_MDNS: "true",
    });
  });
});
