/**
 * Rasterises the brand SVGs in docs/design/brand into the PNGs Android needs: the launcher icon,
 * the adaptive icon layers, the Android TV banner and the splash mark. Run it after the brand
 * changes with `pnpm --filter @slipstream/app brand`; the output in assets/brand is committed so
 * a prebuild never depends on this script.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import resvg from "@resvg/resvg-js";

const brand = new URL("../../../docs/design/brand/", import.meta.url);
const out = new URL("../assets/brand/", import.meta.url);

/** One PNG to produce: source SVG, output name and pixel width (height follows the aspect). */
interface Target {
  readonly svg: string;
  readonly png: string;
  readonly width: number;
}

/**
 * Sizes follow what Expo and Android expect: 1024 px squares for the icon and adaptive layers
 * (Expo scales them per density), the TV banner at xhdpi (320 x 180 dp is 640 x 360 px) and a
 * 1024 px splash mark that Expo shrinks to the splash image width.
 */
const targets: readonly Target[] = [
  { svg: "app-icon.svg", png: "icon.png", width: 1024 },
  { svg: "adaptive-foreground.svg", png: "adaptive-foreground.png", width: 1024 },
  { svg: "adaptive-background.svg", png: "adaptive-background.png", width: 1024 },
  { svg: "adaptive-monochrome.svg", png: "adaptive-monochrome.png", width: 1024 },
  { svg: "tv-banner.svg", png: "tv-banner.png", width: 640 },
  { svg: "mark.svg", png: "splash-mark.png", width: 1024 },
];

await mkdir(out, { recursive: true });
for (const target of targets) {
  const svg = await readFile(new URL(target.svg, brand), "utf8");
  const image = new resvg.Resvg(svg, {
    fitTo: { mode: "width", value: target.width },
    background: "rgba(0, 0, 0, 0)",
  }).render();
  await writeFile(new URL(target.png, out), image.asPng());
  console.log(`${target.png}: ${image.width} x ${image.height}`);
}
