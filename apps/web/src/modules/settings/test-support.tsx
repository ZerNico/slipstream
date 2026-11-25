import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { clientsLayer, makeApi } from "~/api/client.ts";
import { ApiProvider } from "~/api/context.tsx";
import { makeMockServer, type MockOptions, type MockServer } from "~/api/mock/server.ts";
import { mount } from "~/test/dom.tsx";
import { mockOrigin } from "~/api/mock/household.ts";

const origin = mockOrigin;

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

/**
 * Mounts settings and auth screens against the whole mock contract,
 * with the real client, a query client and a memory router that understands overlay params.
 * The mock signs requests in as the admin fixture (`autoSignIn`), like `renderWithApi`.
 */
export const mountWithMock = async (ui: ReactNode, url = "/", options: MockOptions = {}) => {
  const server: MockServer = makeMockServer({ autoSignIn: true, ...options });
  const fetch: typeof globalThis.fetch = (input, init) => server.handler(new Request(input, init));
  const api = makeApi(clientsLayer({ baseUrl: origin, fetch }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mounted = await mount(
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>{ui}</ApiProvider>
    </QueryClientProvider>,
    url,
  );
  return {
    ...mounted,
    server,
    client,
    waitFor,
    /** Everything rendered, the page and its portals (dialogs, sheets). */
    text: () => document.body.textContent ?? "",
    cleanup: async () => {
      await mounted.unmount();
      client.clear();
      await api.dispose();
      await server.dispose();
    },
  };
};
