/**
 * Starts a real server (Node HTTP on an ephemeral port, SQLite in a temp directory) for
 * round-trip tests, plus a small cookie-aware fetch client.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Duration, Effect, Exit, Layer, References, Scope } from "effect";
import { HttpServer } from "effect/http";
import { OnlineArtwork } from "../src/artwork/online-artwork.ts";
import { ServerConfig, type ServerSettings } from "../src/config.ts";
import { Db, type DbShape } from "../src/db/client.ts";
import { makeServer } from "../src/server.ts";
import { testSettings } from "./support.ts";

/** A running test server. */
export interface TestServer {
  readonly url: string;
  readonly root: string;
  readonly db: DbShape;
  /** Runs an effect against the server's services (database writes for seeding). */
  readonly run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  /** Runs one online artwork pass now instead of waiting for the background schedule. */
  readonly lookUpOnlineArtwork: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/** Starts the whole server with state in a fresh temp directory. */
export const startTestServer = async (
  overrides: Partial<ServerSettings> = {},
): Promise<TestServer> => {
  const root = mkdtempSync(join(tmpdir(), "slipstream-http-"));
  const scope = Scope.makeUnsafe();
  const quiet = Layer.succeed(References.MinimumLogLevel, "Error");
  const close = async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const context = await Effect.runPromise(
      Layer.build(
        makeServer().pipe(
          Layer.provideMerge(ServerConfig.layerWith(testSettings(root, overrides))),
          Layer.provide(quiet),
        ),
      ).pipe(Scope.provide(scope)),
    );
    const address = Context.get(context, HttpServer.HttpServer).address;
    if (address._tag === "UnixPathAddress") throw new Error("expected a TCP address");
    return {
      url: `http://127.0.0.1:${address.port}`,
      root,
      db: Context.get(context, Db),
      run: (effect) =>
        Effect.runPromise(effect.pipe(Effect.provideService(References.MinimumLogLevel, "Error"))),
      lookUpOnlineArtwork: () =>
        Effect.runPromise(
          Context.get(context, OnlineArtwork)
            .pass({ lookups: 1000, gap: Duration.zero })
            .pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
        ),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};

/** A fetch client that keeps cookies and sends the CSRF header like the web client must. */
export class Browser {
  readonly cookies = new Map<string, string>();
  readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  /** Sends a request; JSON bodies are encoded, `Set-Cookie` headers are remembered. */
  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const csrf = this.cookies.get("slipstream_csrf");
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookies.size === 0
          ? {}
          : { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") }),
        ...(csrf === undefined || method === "GET" ? {} : { "x-csrf-token": csrf }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(line) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    const json: unknown = text === "" ? undefined : safeJson(text);
    return { status: response.status, headers: response.headers, text, json };
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
