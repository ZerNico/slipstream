// The vitest plugin does not see it.effect / it.live as test blocks (chat and siva turn it off).
/* oxlint-disable vitest/no-standalone-expect */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { M3uXmltvSource, type M3uXmltvConfig } from "./adapter.ts";

const playlistFixture = readFileSync(
  new URL("../fixtures/tvproxy-playlist.m3u", import.meta.url),
  "utf8",
);
const guideFixture = readFileSync(new URL("../fixtures/tvproxy-guide.xml", import.meta.url));

type Handler = (request: IncomingMessage, response: ServerResponse, attempt: number) => void;

/** A real HTTP server on a random local port, closed with the test's scope. */
const serve = (routes: Record<string, Handler>) =>
  Effect.acquireRelease(
    Effect.callback<{ base: string; requests: IncomingMessage[]; server: Server }>((resume) => {
      const requests: IncomingMessage[] = [];
      const attempts = new Map<string, number>();
      const server = createServer((request, response) => {
        requests.push(request);
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        const attempt = (attempts.get(path) ?? 0) + 1;
        attempts.set(path, attempt);
        const handler = routes[path];
        if (handler) handler(request, response, attempt);
        else response.writeHead(404).end("not found");
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resume(Effect.succeed({ base: `http://127.0.0.1:${port}`, requests, server }));
      });
    }),
    ({ server }) =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections();
        server.close(() => resume(Effect.void));
      }),
  );

const send =
  (status: number, body: string | Uint8Array, contentType = "text/plain"): Handler =>
  (_request, response) =>
    response.writeHead(status, { "content-type": contentType }).end(body);

const SourceLive = M3uXmltvSource.layer.pipe(Layer.provide(FetchHttpClient.layer));

const config = (base: string, extra: Partial<M3uXmltvConfig> = {}): M3uXmltvConfig => ({
  playlistUrl: `${base}/playlist.m3u?token=secret-token`,
  retryBaseDelayMs: 5,
  ...extra,
});

describe("M3uXmltvSource", () => {
  it.live("fetches a playlist with the source's user agent and headers", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/playlist.m3u": send(200, playlistFixture, "audio/x-mpegurl"),
      });
      const source = yield* M3uXmltvSource;
      const playlist = yield* source.fetchPlaylist(
        config(server.base, { userAgent: "TestAgent/1.0", headers: { "x-api-key": "abc" } }),
      );
      expect(playlist.entries).toHaveLength(7);
      expect(server.requests[0]?.headers["user-agent"]).toBe("TestAgent/1.0");
      expect(server.requests[0]?.headers["x-api-key"]).toBe("abc");
      expect(server.requests[0]?.url).toBe("/playlist.m3u?token=secret-token");
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("refreshes playlist and gzip guide, finding the guide URL in the playlist", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/playlist.m3u": (request, response) => {
          const host = request.headers.host ?? "";
          send(200, playlistFixture.replaceAll("tvproxy.example:64321", host))(
            request,
            response,
            1,
          );
        },
        "/epg.xml": send(200, gzipSync(guideFixture), "application/octet-stream"),
      });
      const source = yield* M3uXmltvSource;
      const snapshot = yield* source.refresh(config(server.base));
      expect(snapshot.guide.url).toBe(`${server.base}/epg.xml`);
      expect(snapshot.guide.channels).toHaveLength(5);
      expect(snapshot.guide.programmes).toHaveLength(22);
      expect(snapshot.guide.cleanup.duplicatesRemoved).toBe(15);
      expect(snapshot.guide.issues).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("applies rewrite rules from the config", () =>
    Effect.gen(function* () {
      const server = yield* serve({ "/guide.xml": send(200, guideFixture, "text/xml") });
      const source = yield* M3uXmltvSource;
      const guide = yield* source.fetchGuide(
        config(server.base, {
          guideUrl: `${server.base}/guide.xml`,
          rewrites: [{ field: "title", pattern: "^F1: ", set: { title: "Formel 1" } }],
        }),
      );
      expect(guide.programmes.filter((entry) => entry.title === "Formel 1")).toHaveLength(7);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("retries transient failures and then succeeds", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/playlist.m3u": (request, response, attempt) =>
          attempt < 3
            ? send(503, "busy")(request, response, attempt)
            : send(200, playlistFixture)(request, response, attempt),
      });
      const source = yield* M3uXmltvSource;
      const playlist = yield* source.fetchPlaylist(config(server.base));
      expect(playlist.entries).toHaveLength(7);
      expect(server.requests).toHaveLength(3);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("does not retry a 404 and keeps tokens out of the error", () =>
    Effect.gen(function* () {
      const server = yield* serve({});
      const source = yield* M3uXmltvSource;
      const error = yield* Effect.flip(source.fetchPlaylist(config(server.base)));
      expect(error).toMatchObject({
        reason: "http-status",
        status: 404,
        url: `${server.base}/playlist.m3u`,
      });
      expect(error.retryable).toBe(false);
      expect(error.message).not.toContain("secret-token");
      expect(server.requests).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("times out a server that never answers", () =>
    Effect.gen(function* () {
      const server = yield* serve({ "/playlist.m3u": () => undefined });
      const source = yield* M3uXmltvSource;
      const error = yield* Effect.flip(
        source.fetchPlaylist(config(server.base, { timeoutMs: 100, retries: 1 })),
      );
      expect(error.reason).toBe("timeout");
      expect(server.requests).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("times out a guide body that stalls", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/guide.xml": (_request, response) => {
          response.writeHead(200, { "content-type": "text/xml" });
          response.write("<tv><channel id='a'>");
        },
      });
      const source = yield* M3uXmltvSource;
      const error = yield* Effect.flip(
        source.fetchGuide(
          config(server.base, { guideUrl: `${server.base}/guide.xml`, timeoutMs: 150, retries: 0 }),
        ),
      );
      expect(error.reason).toBe("timeout");
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("fetches a guide again when the body breaks off halfway", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/guide.xml": (request, response, attempt) => {
          if (attempt > 1) return send(200, guideFixture, "text/xml")(request, response, attempt);
          response.writeHead(200, { "content-type": "text/xml" });
          response.write(guideFixture.subarray(0, 2000), () => response.destroy());
        },
      });
      const source = yield* M3uXmltvSource;
      const guide = yield* source.fetchGuide(
        config(server.base, { guideUrl: `${server.base}/guide.xml` }),
      );
      expect(guide.programmes).toHaveLength(22);
      expect(server.requests).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("explains a login page served instead of a playlist or guide", () =>
    Effect.gen(function* () {
      const page = "<!DOCTYPE html><html><body>Please log in</body></html>";
      const server = yield* serve({
        "/playlist.m3u": send(200, page, "text/html"),
        "/guide.xml": send(200, page, "text/html"),
      });
      const source = yield* M3uXmltvSource;
      const playlistError = yield* Effect.flip(source.fetchPlaylist(config(server.base)));
      expect(playlistError).toMatchObject({
        reason: "invalid-playlist",
        message: `${server.base}/playlist.m3u returned a web page, not a playlist`,
      });
      const guideError = yield* Effect.flip(
        source.fetchGuide(config(server.base, { guideUrl: `${server.base}/guide.xml` })),
      );
      expect(guideError).toMatchObject({
        reason: "invalid-guide",
        message: `${server.base}/guide.xml: not an XMLTV document: got a web page`,
      });
      // Neither is retried: the same page would come back.
      expect(server.requests).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("reports an unreachable host and a missing guide URL", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/playlist.m3u": send(200, "#EXTM3U\n#EXTINF:-1,A\nhttp://a.example/1\n"),
      });
      const source = yield* M3uXmltvSource;
      const missing = yield* Effect.flip(source.refresh(config(server.base)));
      expect(missing.reason).toBe("no-guide-url");
      const unreachable = yield* Effect.flip(
        source.fetchPlaylist({ playlistUrl: "http://127.0.0.1:9/playlist.m3u", retries: 0 }),
      );
      expect(unreachable.reason).toBe("unreachable");
      expect(unreachable.retryable).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("keeps the source's headers from a guide on another host named by the playlist", () =>
    Effect.gen(function* () {
      const foreign = yield* serve({ "/epg.xml": send(200, guideFixture, "text/xml") });
      const server = yield* serve({
        "/playlist.m3u": send(
          200,
          `#EXTM3U url-tvg="${foreign.base}/epg.xml"\n#EXTINF:-1,A\nhttp://a.example/1\n`,
        ),
        "/epg.xml": send(200, guideFixture, "text/xml"),
      });
      // 127.0.0.1 and localhost are different origins on the same machine.
      const foreignBase = foreign.base.replace("127.0.0.1", "localhost");
      const source = yield* M3uXmltvSource;
      const headers = { authorization: "Bearer secret", "x-api-key": "abc" };

      const guide = yield* source.fetchGuide(
        config(server.base, { headers, userAgent: "TestAgent/1.0" }),
        {
          guideUrls: [`${foreignBase}/epg.xml`],
          attributes: {},
          entries: [],
          issues: [],
        },
      );
      expect(guide.programmes).toHaveLength(22);
      const [leaked] = foreign.requests;
      expect(leaked?.headers["user-agent"]).toBe("TestAgent/1.0");
      expect(leaked?.headers["authorization"]).toBeUndefined();
      expect(leaked?.headers["x-api-key"]).toBeUndefined();

      // The playlist itself, a guide on its origin and a configured guide URL get them.
      yield* source.refresh(config(server.base, { headers }));
      yield* source.fetchGuide(config(server.base, { headers }), {
        guideUrls: [`${server.base}/epg.xml`],
        attributes: {},
        entries: [],
        issues: [],
      });
      yield* source.fetchGuide(
        config(server.base, { headers, guideUrl: `${foreignBase}/epg.xml` }),
      );
      expect(server.requests.map((request) => request.headers["x-api-key"])).toEqual([
        "abc",
        "abc",
      ]);
      expect(foreign.requests.map((request) => request.headers["authorization"])).toEqual([
        undefined,
        undefined,
        "Bearer secret",
      ]);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("refuses playlist and guide bodies past their size limit", () =>
    Effect.gen(function* () {
      const chunk = `#EXTINF:-1,A\nhttp://a.example/1\n`.repeat(100);
      const server = yield* serve({
        // Streamed without a content length: the limit applies while reading.
        "/playlist.m3u": (_request, response) => {
          response.writeHead(200, { "content-type": "audio/x-mpegurl" });
          for (let index = 0; index < 50; index++) response.write(chunk);
          response.end();
        },
        "/declared.m3u": send(200, chunk.repeat(50)),
        "/guide.xml.gz": send(200, gzipSync(guideFixture), "application/octet-stream"),
      });
      const source = yield* M3uXmltvSource;
      const limit = { maxPlaylistBytes: 10_000, maxGuideBytes: 10_000 };

      const streamed = yield* Effect.flip(source.fetchPlaylist(config(server.base, limit)));
      expect(streamed).toMatchObject({ reason: "too-large", limitBytes: 10_000 });
      expect(streamed.retryable).toBe(false);
      const declared = yield* Effect.flip(
        source.fetchPlaylist({
          ...config(server.base, limit),
          playlistUrl: `${server.base}/declared.m3u`,
        }),
      );
      expect(declared).toMatchObject({ reason: "too-large", limitBytes: 10_000 });

      // The gzip is far below the limit; what it inflates to is not.
      expect(gzipSync(guideFixture).byteLength).toBeLessThan(10_000);
      expect(guideFixture.byteLength).toBeGreaterThan(10_000);
      const guide = yield* Effect.flip(
        source.fetchGuide(
          config(server.base, { ...limit, guideUrl: `${server.base}/guide.xml.gz` }),
        ),
      );
      expect(guide).toMatchObject({ reason: "too-large", limitBytes: 10_000 });
      // Not retried: the same body would come back.
      expect(server.requests).toHaveLength(3);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("follows a redirect on the playlist's origin with the source's headers", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/playlist.m3u": (_request, response) =>
          response.writeHead(302, { location: "/moved.m3u?token=next" }).end(),
        "/moved.m3u": send(200, playlistFixture, "audio/x-mpegurl"),
      });
      const source = yield* M3uXmltvSource;
      const playlist = yield* source.fetchPlaylist(
        config(server.base, { headers: { authorization: "Bearer secret" } }),
      );
      expect(playlist.entries).toHaveLength(7);
      expect(server.requests.map((request) => request.url)).toEqual([
        "/playlist.m3u?token=secret-token",
        "/moved.m3u?token=next",
      ]);
      expect(server.requests.map((request) => request.headers["authorization"])).toEqual([
        "Bearer secret",
        "Bearer secret",
      ]);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("drops the source's headers on a redirect to another origin", () =>
    Effect.gen(function* () {
      const foreign = yield* serve({ "/cdn.m3u": send(200, playlistFixture, "audio/x-mpegurl") });
      // 127.0.0.1 and localhost are different origins on the same machine.
      const foreignBase = foreign.base.replace("127.0.0.1", "localhost");
      const server = yield* serve({
        "/playlist.m3u": (_request, response) =>
          response.writeHead(301, { location: `${foreignBase}/cdn.m3u` }).end(),
      });
      const source = yield* M3uXmltvSource;
      const playlist = yield* source.fetchPlaylist(
        config(server.base, {
          userAgent: "TestAgent/1.0",
          headers: { authorization: "Bearer secret", "x-api-key": "abc" },
        }),
      );
      expect(playlist.entries).toHaveLength(7);
      expect(server.requests[0]?.headers["authorization"]).toBe("Bearer secret");
      const [hop] = foreign.requests;
      expect(hop?.headers["user-agent"]).toBe("TestAgent/1.0");
      expect(hop?.headers["authorization"]).toBeUndefined();
      expect(hop?.headers["x-api-key"]).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );

  it.live("stops after five redirects", () =>
    Effect.gen(function* () {
      const server = yield* serve({
        "/playlist.m3u": (_request, response) =>
          response.writeHead(302, { location: "/playlist.m3u?token=again" }).end(),
      });
      const source = yield* M3uXmltvSource;
      const error = yield* Effect.flip(source.fetchPlaylist(config(server.base)));
      expect(error).toMatchObject({ reason: "http-status", status: 302 });
      expect(error.retryable).toBe(false);
      expect(error.message).not.toContain("token");
      // The first request and five redirects; a sixth is not followed.
      expect(server.requests).toHaveLength(6);
    }).pipe(Effect.scoped, Effect.provide(SourceLive)),
  );
});
