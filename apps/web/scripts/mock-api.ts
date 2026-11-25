import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { MockServer } from "../src/api/mock/server.ts";

/** A Node request as a web `Request`, body streamed. */
const toRequest = (req: IncomingMessage): Request => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`), {
    method: req.method ?? "GET",
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
  });
};

/** Writes a web `Response` to Node, streaming so SSE delivers events as they happen. */
const send = (response: Response, res: ServerResponse) => {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  if (response.body === null) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(response.body as NodeReadableStream);
  res.on("close", () => body.destroy());
  body.pipe(res);
};

/**
 * Dev only (`pnpm dev:mock`): serves `/api` from the in-memory mock server in
 * src/api/mock, so every screen can be used and screenshotted without the real server.
 * Playback sessions point at the dev test stream. The mock starts signed in as the admin
 * fixture; `SLIPSTREAM_MOCK_SETUP=1` starts at first-run setup instead.
 */
export function mockApi(): Plugin {
  let mock: Promise<MockServer> | undefined;
  const load = (server: ViteDevServer) => {
    const setup = process.env.SLIPSTREAM_MOCK_SETUP === "1";
    mock ??= server.ssrLoadModule("/src/api/mock/server.ts").then((module) =>
      (module as typeof import("../src/api/mock/server.ts")).makeMockServer({
        autoSignIn: !setup,
        setupRequired: setup,
      }),
    );
    return mock;
  };

  return {
    name: "slipstream-mock-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api", (req, res, next) => {
        // Connect strips the mount path; the mock routes on the full path.
        req.url = `/api${req.url ?? ""}`;
        load(server)
          .then((api) => api.handler(toRequest(req)))
          .then((response) => send(response, res))
          .catch(next);
      });
    },
  };
}
