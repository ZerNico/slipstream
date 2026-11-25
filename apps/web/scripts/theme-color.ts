import { semantic } from "@slipstream/design-tokens";
import type { Plugin } from "vite";
import { storageKeys } from "../src/storage-keys.ts";

/** The stored theme before first paint, so a light choice never flashes dark (SPEC §3.1). */
const storedTheme = `try {
  const theme = localStorage.getItem(${JSON.stringify(storageKeys.theme)});
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
} catch {}`;

/**
 * Puts the canvas colour of each theme into index.html as `theme-color`, so the browser and
 * an installed PWA colour their chrome like the page, and the stored theme choice before first
 * paint. The colours come from the tokens and the key from the app's storage keys, never from a
 * copy that could drift. `data-scheme` lets a manual theme choice retarget the colours.
 */
export function themeColor(): Plugin {
  return {
    name: "slipstream-theme-color",
    transformIndexHtml: () => [
      ...(["dark", "light"] as const).map((scheme) => ({
        tag: "meta",
        attrs: {
          name: "theme-color",
          content: semantic[scheme].bg.canvas,
          media: `(prefers-color-scheme: ${scheme})`,
          "data-scheme": scheme,
        },
        injectTo: "head" as const,
      })),
      { tag: "script", children: storedTheme, injectTo: "head" as const },
    ],
  };
}
