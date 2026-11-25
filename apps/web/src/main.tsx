import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browserApi } from "./api/client.ts";
import { ApiProvider } from "./api/context.tsx";
import { isTransient, isUnauthorized } from "./api/errors.ts";
import { createQueries, keys } from "./api/queries.ts";
import { persistShapes } from "./api/shape-cache.ts";
import { initLocale } from "./i18n/locale.ts";
import { routeTree } from "./routeTree.gen.ts";
import { RouteError, RouteNotFound } from "./shell/route-error.tsx";
import { fontWaitMs } from "./ui/skeleton-state.ts";
import { initTheme } from "./ui/theme.ts";
// Self-hosted UI faces: a home server never depends on a font CDN (SPEC §3.2, §6.3).
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter-tight/wght.css";
import "./styles/app.css";

initLocale();
initTheme();

const api = browserApi();
const queries = createQueries(api);

/**
 * A session that ends while the app is open (expired, revoked from another device) shows up
 * as Unauthorized on whatever read or write comes next. Every one of them leads to sign-in,
 * with the way back to where the person was.
 */
const onError = (error: unknown) => {
  if (!isUnauthorized(error) || window.location.pathname === "/login") return;
  queryClient.removeQueries({ queryKey: keys.me });
  void router.navigate({
    to: "/login",
    search: { redirect: `${window.location.pathname}${window.location.search}` },
  });
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Once more after a lost connection or a hiccup; a declared error (no session, not
      // found, refused) answers the same the second time.
      retry: (count, error) => isTransient(error) && count < 1,
    },
  },
});
// The last answers of the shared reads, for the next page load's skeletons (SPEC §6.2).
persistShapes(queryClient.getQueryCache());

const router = createRouter({
  routeTree,
  context: { queryClient, queries },
  scrollRestoration: true,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  // The skeleton is the pending state of the real layout (SPEC §6.2): no delay, no spinner.
  defaultPendingMs: 0,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

/**
 * The UI faces before the first paint, for at most {@link fontWaitMs}: text drawn in the
 * fallback and swapped to Inter a moment later changes width, which moves whatever sits beside
 * it (SPEC §6.3). A cached font resolves at once; a slow one never holds the app back for long.
 */
const uiFontsOrTimeout = (): Promise<unknown> =>
  Promise.race([
    Promise.all([
      document.fonts.load('400 1em "Inter Variable"'),
      document.fonts.load('600 1em "Inter Variable"'),
      document.fonts.load('700 1em "Inter Tight Variable"'),
    ]),
    new Promise((resolve) => window.setTimeout(resolve, fontWaitMs)),
  ]);

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api} queries={queries}>
          <RouterProvider router={router} />
        </ApiProvider>
      </QueryClientProvider>
    </StrictMode>,
  );

void uiFontsOrTimeout().then(render, render);
