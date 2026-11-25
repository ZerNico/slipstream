import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every image app.json points at must exist at the size Android expects; a missing or wrong
 * file only shows up deep inside `expo prebuild` otherwise.
 */
const app = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("app.json", app), "utf8")) as {
  expo: {
    icon: string;
    android: { adaptiveIcon: Record<string, string> };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (path: string): { width: number; height: number } => {
  const bytes = readFileSync(new URL(path, app));
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const pluginOption = (name: string, key: string): string => {
  const entry = config.expo.plugins.find(
    (plugin): plugin is [string, Record<string, unknown>] =>
      Array.isArray(plugin) && plugin[0] === name,
  );
  const value = entry?.[1][key];
  if (typeof value !== "string") throw new Error(`${name} has no ${key}`);
  return value;
};

describe("brand assets", () => {
  it("has a 1024 px launcher icon and adaptive layers", () => {
    const paths = [config.expo.icon, ...Object.values(config.expo.android.adaptiveIcon)];
    expect(paths).toHaveLength(4);
    for (const path of paths) expect(pngSize(path)).toEqual({ width: 1024, height: 1024 });
  });

  it("has a 16:9 TV banner at xhdpi", () => {
    expect(pngSize(pluginOption("@react-native-tvos/config-tv", "androidTVBanner"))).toEqual({
      width: 640,
      height: 360,
    });
  });

  it("has the splash mark and the remote key plugins", () => {
    expect(pngSize(pluginOption("expo-splash-screen", "image")).width).toBe(1024);
    expect(config.expo.plugins).toContain("./plugins/with-digit-keys.cjs");
    expect(existsSync(new URL("plugins/with-digit-keys.cjs", app))).toBe(true);
    expect(config.expo.plugins).toContain("./plugins/with-key-down-events.cjs");
    expect(existsSync(new URL("plugins/with-key-down-events.cjs", app))).toBe(true);
  });
});
