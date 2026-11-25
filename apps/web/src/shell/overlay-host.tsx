import { type ComponentType, lazy, Suspense } from "react";
import type { Overlay, OverlayKind } from "~/ui/overlay/overlay-state.ts";
import { useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";

/** What a global overlay component receives: its URL overlay and the open state. */
export interface OverlayComponentProps {
  readonly open: boolean;
  readonly overlay: Overlay;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Overlays that can open from anywhere, by URL. Each is loaded on first use. Overlays that only open from one page (the player's `?sheet=info`, the
 * guide's `?dlg=filter|day`, settings' `?dlg=invite`) are mounted by that page instead, and the
 * shell's own (`cmdk`, `keys`, `account`) are rendered by the shell.
 */
const globalOverlays: ReadonlyArray<{
  readonly kind: OverlayKind;
  readonly name?: string;
  readonly component: ComponentType<OverlayComponentProps>;
}> = [
  { kind: "choice", component: lazy(() => import("~/modules/watch/choice-overlay.tsx")) },
  {
    kind: "sheet",
    name: "prog",
    component: lazy(() => import("~/modules/guide/programme-sheet.tsx")),
  },
  { kind: "dlg", name: "pin", component: lazy(() => import("~/modules/settings/pin-dialog.tsx")) },
];

function GlobalOverlay({
  kind,
  name,
  component: Component,
}: {
  kind: OverlayKind;
  name?: string;
  component: ComponentType<OverlayComponentProps>;
}) {
  const binding = useOverlayBinding(kind, name);
  if (!binding.overlay) return null;
  return (
    <Suspense fallback={null}>
      <Component
        open={binding.open}
        overlay={binding.overlay}
        onOpenChange={binding.onOpenChange}
      />
    </Suspense>
  );
}

/** Renders whichever global overlay the URL names. */
export function OverlayHost() {
  return globalOverlays.map((entry) => (
    <GlobalOverlay key={`${entry.kind}:${entry.name ?? ""}`} {...entry} />
  ));
}
