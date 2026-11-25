import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Schedule, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";
import {
  Authentication,
  csrfCookie,
  csrfHeader,
  csrfSafeMethods,
  type ServerEvent,
  SlipstreamApi,
} from "@slipstream/api";
import { ApiError, toProblem } from "./errors.ts";

/** The typed client for the whole Slipstream contract. */
export type SlipstreamClient = HttpApiClient.ForApi<typeof SlipstreamApi>;

/** The client, built once per runtime. */
export class Clients extends Context.Service<Clients, { readonly api: SlipstreamClient }>()(
  "@slipstream/web/Clients",
) {}

/**
 * The browser sends the session cookie on its own (same origin), so the client side of the
 * `Authentication` middleware passes requests through untouched.
 */
const AuthenticationClient = HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
  next(request),
);

/** Reads one cookie from a `document.cookie` style string. */
export const readCookie = (cookies: string, name: string): string | undefined => {
  for (const pair of cookies.split(";")) {
    const [key = "", ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
};

/** The page's CSRF token, from the readable cookie the server sets beside the session. */
const documentCsrfToken = (): string | undefined =>
  typeof document === "undefined" ? undefined : readCookie(document.cookie, csrfCookie);

/**
 * Copies the CSRF cookie into the `csrfHeader` on every state-changing request, which the
 * server demands of requests it authenticates by the session cookie.
 */
const withCsrf =
  (token: () => string | undefined) =>
  (client: HttpClient.HttpClient): HttpClient.HttpClient =>
    HttpClient.mapRequest(client, (request) => {
      if (csrfSafeMethods.has(request.method)) return request;
      const value = token();
      return value === undefined
        ? request
        : HttpClientRequest.setHeader(request, csrfHeader, value);
    });

/**
 * The client over `fetch`. `fetch` is the platform's unless one is given: tests hand in the mock
 * server's web handler, so they exercise exactly the production wiring. `csrfToken` reads the
 * CSRF cookie; the page's `document.cookie` by default.
 */
export const clientsLayer = (options: {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly csrfToken?: () => string | undefined;
}): Layer.Layer<Clients> =>
  Layer.effect(
    Clients,
    Effect.gen(function* () {
      const settings = {
        baseUrl: options.baseUrl,
        transformClient: withCsrf(options.csrfToken ?? documentCsrfToken),
      };
      const api = yield* HttpApiClient.make(SlipstreamApi, settings);
      return { api };
    }),
  ).pipe(
    Layer.provide(AuthenticationClient),
    Layer.provide(FetchHttpClient.layer),
    // Same origin needs no trace headers, and a preflight to another origin would refuse them.
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled)(false)),
    Layer.provide(
      options.fetch === undefined
        ? Layer.empty
        : Layer.succeed(FetchHttpClient.Fetch)(options.fetch),
    ),
  );

/**
 * How the live event stream is doing, for the "No connection" notice. `open` means the
 * server's `Connected` event arrived, not merely that the response started.
 */
export type EventsStatus = "connecting" | "open" | "retrying";

/**
 * Reconnects after 1 s, doubling up to 30 s, with jitter so a restarted server is not hit by
 * every tab at once.
 */
const reconnect = Schedule.min([
  Schedule.exponential("1 second"),
  Schedule.spaced("30 seconds"),
]).pipe(Schedule.jittered);

/**
 * The bridge between Effect and the React side: runs client calls as promises that reject with
 * an {@link ApiError}, and runs the event stream as a fiber that a returned function stops.
 */
export interface Api {
  /** Calls the Slipstream contract. */
  readonly call: <A, E>(f: (client: SlipstreamClient) => Effect.Effect<A, E>) => Promise<A>;
  /**
   * Follows `/api/events` until the returned function is called, reconnecting with backoff.
   * `onStatus` hears every connect, open (the `Connected` event) and retry.
   */
  readonly events: (
    onEvent: (event: ServerEvent) => void,
    onStatus: (status: EventsStatus) => void,
  ) => () => void;
  /** Stops every running call and stream. */
  readonly dispose: () => Promise<void>;
}

/** Builds the {@link Api} on a runtime made from `layer`. */
export const makeApi = (layer: Layer.Layer<Clients>): Api => {
  const runtime = ManagedRuntime.make(layer);

  const run = async <A, E>(effect: Effect.Effect<A, E, Clients>): Promise<A> => {
    const exit = await runtime.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return exit.value;
    throw new ApiError(toProblem(Cause.squash(exit.cause)));
  };

  return {
    call: (f) =>
      run(
        Effect.gen(function* () {
          const { api } = yield* Clients;
          return yield* f(api);
        }),
      ),
    events: (onEvent, onStatus) => {
      const follow = Effect.gen(function* () {
        const { api } = yield* Clients;
        onStatus("connecting");
        const stream = yield* api.system.events();
        yield* Stream.runForEach(stream, (event) =>
          Effect.sync(() => {
            if (event._tag === "Connected") onStatus("open");
            onEvent(event);
          }),
        );
        // A stream that ends cleanly (server restart) is reconnected like a failed one.
        return yield* Effect.fail("ended" as const);
      }).pipe(
        Effect.tapError(() => Effect.sync(() => onStatus("retrying"))),
        Effect.retry(reconnect),
      );
      const fiber = runtime.runFork(follow);
      return () => {
        fiber.interruptUnsafe();
      };
    },
    dispose: () => runtime.dispose(),
  };
};

/** The production API: same origin as the page, through the browser's `fetch`. */
export const browserApi = (): Api => makeApi(clientsLayer({ baseUrl: window.location.origin }));
