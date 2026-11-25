import { sessionCookie } from "@slipstream/api";
import { type Api, clientsLayer, makeApi } from "../client.ts";
import { makeMockServer, type MockOptions, type MockServer } from "./server.ts";
import { mockOrigin } from "./household.ts";

/** Where tests pretend the page is served from. */
const ORIGIN = mockOrigin;

/**
 * A `fetch` into the mock that keeps the session the server hands out, the way a browser on
 * the same origin keeps its cookie. A `cookie` request header is forbidden outside Node, so
 * the session travels as the bearer token, which the mock checks against the same sessions.
 * DOM environments also hide `Set-Cookie`, so DOM tests start the mock with `autoSignIn`.
 */
const browserFetch = (server: MockServer): typeof globalThis.fetch => {
  let session: string | undefined;
  return async (input, init) => {
    const base = new Request(input, init);
    const headers = new Headers(base.headers);
    if (session !== undefined) headers.set("authorization", `Bearer ${session}`);
    const response = await server.handler(new Request(base, { headers }));
    for (const header of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";");
      const [name = "", value = ""] = pair.trim().split("=");
      if (name !== sessionCookie) continue;
      const expired = attributes.some((attribute) => /max-age=0/iu.test(attribute.trim()));
      session = expired || value === "" ? undefined : value;
    }
    return response;
  };
};

/** The production client wired to a fresh mock server. */
export const mockApi = (options: MockOptions = {}): { api: Api; server: MockServer } => {
  const server = makeMockServer({ playlistUrl: "/hls/test.m3u8", ...options });
  const api = makeApi(clientsLayer({ baseUrl: ORIGIN, fetch: browserFetch(server) }));
  return { api, server };
};
