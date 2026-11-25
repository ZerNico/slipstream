import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devPorts } from "../../scripts/dev-state.ts";
import { devStream } from "./scripts/dev-stream.ts";
import { mockApi } from "./scripts/mock-api.ts";
import { themeColor } from "./scripts/theme-color.ts";

/** `pnpm dev:mock` answers /api from the in-memory mock instead of a server. */
const mock = process.env.SLIPSTREAM_MOCK === "1";

/** This checkout's dev ports (root `pnpm dev` passes the same ones explicitly). */
const ports = devPorts();

/** Where the Slipstream server runs in dev; /api and /hls are proxied there. */
const server = process.env.SLIPSTREAM_SERVER_URL ?? `http://127.0.0.1:${ports.server}`;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // `pnpm dev --lan` sets 0.0.0.0 so phones on the network can open the web app.
    host: process.env.SLIPSTREAM_DEV_HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? ports.web),
    // The printed URL is the one in use; another checkout's port is never silently taken.
    strictPort: true,
    // The test stream's segments are written into .data; they must not reload the page.
    watch: { ignored: ["**/.data/**"] },
    proxy: {
      ...(mock ? {} : { "/api": { target: server, changeOrigin: false } }),
      "/hls": { target: server, changeOrigin: false },
    },
  },
  // hls.js alone is about 520 KB minified; it ships in the player routes' chunks only.
  build: { chunkSizeWarningLimit: 700 },
  plugins: [
    // File-based routes; each route is its own chunk, so hls.js loads with the player only.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    // React Compiler memoizes components and hooks, so a parent's render leaves unchanged
    // children alone.
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    themeColor(),
    devStream(),
    ...(mock ? [mockApi()] : []),
  ],
});
