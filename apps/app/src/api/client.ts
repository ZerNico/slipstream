import { SlipstreamApi } from "@slipstream/api";
import { Context, Effect, Layer, ManagedRuntime, Predicate } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

/** Where the app talks to: the server's origin and, once signed in, the device token. */
export interface Connection {
  /** Origin such as `http://192.168.12.11:8080`; the API lives under `/api`. */
  readonly baseUrl: string;
  readonly token: string | undefined;
}

/** Builds the typed client for the whole API, attaching the device token as a bearer header. */
export const makeClient = (connection: Connection) =>
  HttpApiClient.make(SlipstreamApi, {
    baseUrl: connection.baseUrl,
    transformClient: (client) =>
      connection.token === undefined
        ? client
        : client.pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken(connection.token))),
  });

/** The typed Slipstream client: `api.guide.window(...)`, `api.auth.pollDeviceCode(...)`. */
export type SlipstreamClient = Effect.Success<ReturnType<typeof makeClient>>;

/** The API client for the current connection, provided per server and account. */
export class Api extends Context.Service<Api, SlipstreamClient>()("@slipstream/app/Api") {
  /** The client for one connection over whichever HTTP client is provided (tests fake it). */
  static readonly layerOver = (
    connection: Connection,
  ): Layer.Layer<Api, never, HttpClient.HttpClient> => Layer.effect(Api, makeClient(connection));

  /** The client over `fetch` for one connection. */
  static readonly layer = (connection: Connection): Layer.Layer<Api> =>
    Api.layerOver(connection).pipe(Layer.provide(FetchHttpClient.layer));
}

/**
 * Whether a failed request means the server no longer accepts this device token (revoked on
 * the web, expired, or the profile deleted). Retrying cannot help; the app forgets the profile.
 */
export const isUnauthorized = (error: unknown): boolean =>
  Predicate.isTagged(error, "Unauthorized");

/** Runs API effects for one connection; screens get it from the session. */
export type ApiRuntime = ManagedRuntime.ManagedRuntime<Api, never>;

/** A runtime for one connection. Dispose it when the connection changes. */
export const makeApiRuntime = (connection: Connection): ApiRuntime =>
  ManagedRuntime.make(Api.layer(connection));

/** Normalises what a person typed or discovery found into an origin, or undefined if invalid. */
export const normaliseServerUrl = (input: string): string | undefined => {
  const trimmed = input.trim();
  if (trimmed === "" || /\s/u.test(trimmed)) return undefined;
  const withScheme = /^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.hostname === "") return undefined;
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return undefined;
  }
};

/** Resolves a URL the server returned (often a path like `/hls/...`) against its origin. */
export const resolveServerUrl = (baseUrl: string, url: string): string =>
  new URL(url, `${baseUrl}/`).toString();
