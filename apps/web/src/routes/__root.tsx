import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { useLocale } from "~/i18n/locale.ts";
import { RouteError, RouteNotFound } from "~/shell/route-error.tsx";
import type { RouterContext } from "~/shell/route-guards.ts";
import { Announcer } from "~/ui/announce.tsx";
import { validateOverlaySearch } from "~/ui/overlay/overlay-state.ts";
import { TooltipProvider } from "~/ui/primitives/tooltip.tsx";
import { Toaster } from "~/ui/toast.tsx";

/**
 * The root: providers every screen shares (tooltips, toasts, the polite live region) and the
 * overlay params (`?sheet=`, `?dlg=`, `?choice=`) that every route accepts (SPEC §11).
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: validateOverlaySearch,
  component: Root,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
});

function Root() {
  // Messages are read at render time; a new language re-renders the whole tree.
  const locale = useLocale();
  return (
    <TooltipProvider key={locale}>
      <Toaster>
        <Outlet />
        <Announcer />
      </Toaster>
    </TooltipProvider>
  );
}
