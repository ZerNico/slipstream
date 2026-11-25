/**
 * Writes expo-router's typed routes (`.expo/types/router.d.ts`) without Metro, so `typecheck`
 * checks every `Href` in CI as it does while `expo start` runs. Uses the same generator the
 * Expo CLI calls; `expo customize tsconfig.json` would also do it but rewrites tsconfig.json.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const fromRouter = createRequire(require.resolve("expo-router/package.json"));

// Typed routes read the app folder from this variable, which Metro sets when it bundles.
process.env["EXPO_ROUTER_APP_ROOT"] = path.join(root, "app");

const typedRoutes = fromRouter("@expo/router-server/build/typed-routes") as {
  readonly regenerateDeclarations: (outputDir: string, options?: object) => void;
};
const typesDirectory = path.join(root, ".expo", "types");
mkdirSync(typesDirectory, { recursive: true });
typedRoutes.regenerateDeclarations(typesDirectory, {});

// The file Expo writes next to the app on start; it pulls in Expo's own types.
const envFile = path.join(root, "expo-env.d.ts");
if (!existsSync(envFile)) {
  writeFileSync(
    envFile,
    '/// <reference types="expo/types" />\n\n// NOTE: This file should not be edited and should be in your git ignore',
  );
}
