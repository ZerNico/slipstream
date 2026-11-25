import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Api } from "~/api/client.ts";
import { ApiProvider } from "~/api/context.tsx";
import type { MockOptions, MockServer } from "~/api/mock/server.ts";
import { mockApi } from "~/api/mock/testing.ts";
import { actEnvironment, clickIn } from "./act.ts";

/** A mounted tree against a signed-in mock server, and ways to look at and drive it. */
export interface Rendered {
  readonly host: HTMLElement;
  readonly api: Api;
  readonly server: MockServer;
  readonly client: QueryClient;
  /** Waits until `check` stops throwing, letting React and the mock make progress. */
  readonly waitFor: (check: () => void, timeoutMs?: number) => Promise<void>;
  readonly click: (element: Element | null | undefined) => Promise<void>;
  readonly text: () => string;
  readonly unmount: () => Promise<void>;
}

/** Waits until `check` stops throwing, letting React and the mock make progress. */
const waitFor = async (check: () => void, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    }
  }
};

/**
 * Renders `ui` with the real API client wired to a fresh mock server, signed in as Alex.
 * Needs the happy-dom environment, which hides `Set-Cookie` like a browser does, so the mock
 * signs requests in on its own (`autoSignIn`).
 */
export const renderWithApi = async (
  ui: ReactNode,
  options: MockOptions = {},
): Promise<Rendered> => {
  actEnvironment();
  const { api, server } = mockApi({ autoSignIn: true, ...options });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // A one-route router, so components with links render as they do in the app.
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory(),
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ApiProvider api={api}>
          <RouterProvider router={router} />
        </ApiProvider>
      </QueryClientProvider>,
    );
  });

  return {
    host,
    api,
    server,
    client,
    waitFor,
    click: clickIn,
    text: () => host.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
      client.clear();
      await api.dispose();
      await server.dispose();
    },
  };
};
