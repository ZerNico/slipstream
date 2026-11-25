import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { validateOverlaySearch } from "~/ui/overlay/overlay-state.ts";
import { actEnvironment, clickIn } from "./act.ts";

/** A mounted component tree in happy-dom, and ways to drive it. */
export interface Mounted {
  readonly host: HTMLElement;
  /** Lets React, timers and Base UI's animations settle. */
  readonly settle: (ms?: number) => Promise<void>;
  readonly click: (element: Element | null | undefined) => Promise<void>;
  /** Dispatches a keydown on the focused element (or `target`). */
  readonly key: (key: string, init?: KeyboardEventInit, target?: Element | null) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

const settleFor = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/**
 * Mounts `ui` inside a one-route memory router (so links and the overlay hook work) at
 * `initialUrl`. Needs `// @vitest-environment happy-dom`.
 */
export const mount = async (
  ui: ReactNode,
  initialUrl = "/",
): Promise<Mounted & { readonly url: () => string; readonly back: () => Promise<void> }> => {
  actEnvironment();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  // The root takes the overlay params like the app's; one splat route matches every path, so
  // relative navigation ("." with new search params) keeps the path as it does in the app.
  const rootRoute = createRootRoute({
    validateSearch: validateOverlaySearch,
    component: () => <Outlet />,
  });
  const anyPath = createRoute({ getParentRoute: () => rootRoute, path: "$", component: () => ui });
  const index = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => ui });
  const router = createRouter({ routeTree: rootRoute.addChildren([index, anyPath]), history });
  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });
  await settleFor(20);
  return {
    host,
    url: () => `${router.state.location.pathname}${router.state.location.searchStr}`,
    back: async () => {
      await act(async () => {
        history.back();
      });
      await settleFor(30);
    },
    settle: (ms = 30) => settleFor(ms),
    click: async (element) => {
      await clickIn(element);
      await settleFor(30);
    },
    key: async (key, init = {}, target) => {
      const element = target ?? document.activeElement ?? document.body;
      await act(async () => {
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
        );
      });
      await settleFor(20);
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
};
