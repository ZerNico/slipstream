import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { navItems } from "./nav.ts";

/**
 * Whether a key press belongs to a text field rather than to the app. A focused range input
 * (volume) is not typing: it takes arrows and Home/End, every other shortcut passes (SPEC §7.2).
 */
export const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement)
    return target.type !== "range" && target.type !== "checkbox";
  return target.getAttribute("role") === "combobox";
};

/** What a global key press does. */
export type ShortcutAction =
  | { readonly kind: "palette" }
  | { readonly kind: "keys" }
  | { readonly kind: "go-prefix" }
  | { readonly kind: "go"; readonly to: string }
  | { readonly kind: "none" };

/** How long `G` waits for its second key, ms. */
export const goPrefixMs = 1200;

/**
 * Maps a key press to an action (SPEC §7.2): ⌘K, Ctrl K or `/` open the palette, `?` the
 * shortcuts, `G` then H/G/R/E/S go to Home, Guide, Recordings, Series, Settings.
 */
export const shortcutFor = (
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
  goPending: boolean,
): ShortcutAction => {
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "k") return { kind: "palette" };
  if (event.metaKey || event.ctrlKey || event.altKey) return { kind: "none" };
  if (goPending) {
    const item = navItems.find((candidate) => candidate.key2 === key);
    return item ? { kind: "go", to: item.to } : { kind: "none" };
  }
  if (key === "/") return { kind: "palette" };
  if (key === "?") return { kind: "keys" };
  if (key === "g") return { kind: "go-prefix" };
  return { kind: "none" };
};

/** Listens for the global shortcuts while the app shell is mounted. */
export function useGlobalShortcuts(): void {
  const overlay = useOverlay();
  const navigate = useNavigate();
  useEffect(() => {
    let goUntil = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const palette = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!palette && isTyping(event.target)) return;
      const action = shortcutFor(event, Date.now() < goUntil);
      goUntil = 0;
      switch (action.kind) {
        case "palette":
          event.preventDefault();
          overlay.open({ kind: "dlg", name: "cmdk" });
          return;
        case "keys":
          event.preventDefault();
          overlay.open({ kind: "dlg", name: "keys" });
          return;
        case "go-prefix":
          goUntil = Date.now() + goPrefixMs;
          return;
        case "go":
          event.preventDefault();
          void navigate({ to: action.to });
          return;
        case "none":
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, navigate]);
}
