/**
 * The artwork-only faces (Anton for sport, DM Serif Display for crime and film, Fredoka for
 * kids) load on first use with `font-display: optional`, so UI text never waits for them and
 * generated artwork simply keeps its fallback when they are slow (SPEC §3.2, §6.3).
 */
import antonUrl from "@fontsource/anton/files/anton-latin-400-normal.woff2?url";
import serifUrl from "@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2?url";
import fredokaUrl from "@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2?url";

const faces: ReadonlyArray<readonly [string, string, FontFaceDescriptors]> = [
  ["Anton", antonUrl, { weight: "400", display: "optional" }],
  ["DM Serif Display", serifUrl, { weight: "400", display: "optional" }],
  ["Fredoka Variable", fredokaUrl, { weight: "300 700", display: "optional" }],
];

let requested = false;

/** Starts loading the artwork faces once per page; later calls do nothing. */
export const loadArtworkFonts = (): void => {
  if (requested || typeof document === "undefined" || typeof FontFace === "undefined") return;
  requested = true;
  for (const [family, url, descriptors] of faces) {
    const face = new FontFace(family, `url(${url}) format("woff2")`, descriptors);
    document.fonts.add(face);
    // A face that fails to load leaves the fallback in place, which artwork is drawn to tolerate.
    face.load().catch(() => undefined);
  }
};
