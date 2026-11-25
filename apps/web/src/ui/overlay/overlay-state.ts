/**
 * Overlays live in the URL (SPEC §11): `?sheet=<SheetName>[:arg]` (`prog:<id>`),
 * `?dlg=<DialogName or MenuName>[:arg]` (`invite:<id>`, `pin:<profile>`) and `?choice=<recId>`.
 * The back button and the back gesture close an overlay before they leave the page. Pure
 * functions here; the React hooks are in use-overlay.tsx.
 */

/** The sheets: a programme, the player's info, the kitchen sink's demo. */
export type SheetName = "prog" | "info" | "demo";

/** The dialogs. */
export type DialogName =
  | "cmdk"
  | "keys"
  | "invite"
  | "pin"
  | "profile"
  | "override"
  | "source"
  | "streams"
  | "merge-review"
  | "gone-review";

/** The menus, which are sheets under `?dlg=` on phones (`ResponsiveMenu`). */
export type MenuName =
  | "account"
  | "recording"
  | "filter"
  | "day"
  | "more"
  | "move"
  | "part"
  | "audio"
  | "quality"
  | "ks-menu";

/** The names an overlay of a kind can have; the watch choice's is the recording id. */
export type OverlayName<K extends OverlayKind> = K extends "sheet"
  ? SheetName
  : K extends "dlg"
    ? DialogName | MenuName
    : string;

/** The search keys that hold an overlay. At most one is set at a time. */
export const overlayKeys = ["sheet", "dlg", "choice"] as const;

/** Which kind of overlay: a sheet, a dialog (or a menu rendered as a sheet), the watch choice. */
export type OverlayKind = (typeof overlayKeys)[number];

/**
 * An open overlay as the URL holds it: `?sheet=prog:42` is `{ kind: "sheet", name: "prog",
 * arg: "42" }`. Read from a URL, the name may be any text.
 */
export interface Overlay {
  readonly kind: OverlayKind;
  /** The overlay's name; for the watch choice, the recording id. */
  readonly name: string;
  /** What it is about (`prog:<id>`, `invite:<id>`, `pin:<profile>`), if anything. */
  readonly arg?: string;
}

/** An overlay to open: only names that exist for its kind. */
export type OverlayTarget = {
  readonly [K in OverlayKind]: {
    readonly kind: K;
    readonly name: OverlayName<K>;
    readonly arg?: string;
  };
}[OverlayKind];

/** The search params the overlay keys add to every route. */
export interface OverlaySearch {
  readonly sheet?: string;
  readonly dlg?: string;
  readonly choice?: string;
}

/** Keeps only valid overlay params from raw search params (the root route's validator). */
export const validateOverlaySearch = (search: Record<string, unknown>): OverlaySearch => {
  const out: { sheet?: string; dlg?: string; choice?: string } = {};
  for (const key of overlayKeys) {
    const value = search[key];
    if (typeof value === "string" && value !== "") out[key] = value;
    // Numeric ids arrive parsed as numbers; keep them as text.
    if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
  }
  return out;
};

/** The overlay in a set of search params, or null. The first key in `overlayKeys` wins. */
export const readOverlay = (search: OverlaySearch): Overlay | null => {
  for (const kind of overlayKeys) {
    const value = search[kind];
    if (value === undefined || value === "") continue;
    if (kind === "choice") return { kind, name: value };
    const split = value.indexOf(":");
    return split === -1
      ? { kind, name: value }
      : { kind, name: value.slice(0, split), arg: value.slice(split + 1) };
  }
  return null;
};

/** The URL value of an overlay: `prog:42`, `cmdk`, or the recording id for a choice. */
export const overlayValue = (overlay: Overlay): string =>
  overlay.kind === "choice" || overlay.arg === undefined
    ? overlay.name
    : `${overlay.name}:${overlay.arg}`;

/**
 * Search params with `overlay` as the only overlay (or none). Other params stay as they are,
 * so a page's own state (the guide's day, the library filter) survives opening a sheet.
 */
export const withOverlay = <S extends OverlaySearch>(
  search: S,
  overlay: Overlay | null,
): S & OverlaySearch => {
  const next: Record<string, unknown> = { ...(search as Record<string, unknown>) };
  for (const key of overlayKeys) delete next[key];
  if (overlay) next[overlay.kind] = overlayValue(overlay);
  return next as S & OverlaySearch;
};

/** Whether two overlays are the same one. */
export const sameOverlay = (a: Overlay | null, b: Overlay | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && overlayValue(a) === overlayValue(b));

/**
 * How to open an overlay: push one history entry when none is open, replace the entry when one
 * overlay replaces another, so Back always lands on the page under it.
 */
export const openMode = (current: Overlay | null): "push" | "replace" =>
  current === null ? "push" : "replace";

/**
 * How to close an overlay: go back when this page pushed it (Back would do the same), replace
 * the entry when it came from a deep link (going back would leave the app).
 */
export const closeMode = (pushedHere: boolean): "back" | "replace" =>
  pushedHere ? "back" : "replace";
