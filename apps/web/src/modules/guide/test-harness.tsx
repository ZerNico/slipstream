import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import type { Api } from "~/api/client.ts";
import { ApiProvider } from "~/api/context.tsx";
import { HouseholdZone } from "~/api/household-zone.tsx";
import type { MockOptions, MockServer } from "~/api/mock/server.ts";
import { mockApi } from "~/api/mock/testing.ts";
import { mount } from "~/test/dom.tsx";

/** A guide screen mounted in a memory router against a fresh mock server, for DOM tests. */
export interface GuideHarness {
  readonly server: MockServer;
  readonly url: () => string;
  readonly settle: (ms?: number) => Promise<void>;
  readonly click: (element: Element | null | undefined) => Promise<void>;
  readonly key: (key: string, init?: KeyboardEventInit, target?: Element | null) => Promise<void>;
  /** Waits until `check` stops throwing. */
  readonly waitFor: (check: () => void, timeoutMs?: number) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

/** Waits until `check` stops throwing, letting React and the mock make progress. */
const waitFor = async (check: () => void, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await act(() => new Promise((resolve) => setTimeout(resolve, 15)));
    }
  }
};

/** Media queries that match while the harness runs; everything else does not. */
export const setMedia = (matching: readonly string[]): void => {
  window.matchMedia = (query: string) => ({
    matches: matching.includes(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
};

/**
 * Mounts `ui` with the real client wired to a mock server (signed in as the admin), in a router
 * with the app's overlay params at `url`.
 */
export const mountGuide = async (
  ui: ReactNode,
  options: {
    readonly url?: string;
    readonly mock?: MockOptions;
    /** Wraps the client, to answer a call the mock never fails the way a real server can. */
    readonly wrap?: (api: Api) => Api;
    /** Changes the mock's data before anything is read (a household without collections). */
    readonly prepare?: (server: MockServer) => void;
  } = {},
): Promise<GuideHarness> => {
  const { api, server } = mockApi({ autoSignIn: true, ...options.mock });
  options.prepare?.(server);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mounted = await mount(
    <QueryClientProvider client={client}>
      <ApiProvider api={options.wrap?.(api) ?? api}>
        {/* As in the app: times are written in the server's zone, whatever the machine's is. */}
        <HouseholdZone>{ui}</HouseholdZone>
      </ApiProvider>
    </QueryClientProvider>,
    options.url ?? "/guide",
  );
  return {
    server,
    url: mounted.url,
    settle: mounted.settle,
    click: mounted.click,
    key: mounted.key,
    waitFor,
    unmount: async () => {
      await mounted.unmount();
      client.clear();
      await api.dispose();
      await server.dispose();
    },
  };
};
