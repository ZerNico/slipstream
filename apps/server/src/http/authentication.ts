/**
 * The `Authentication` middleware from `@slipstream/api`, and the cookie handling around it.
 *
 * Browsers authenticate with the HTTP-only `slipstream_session` cookie. Because browsers send
 * cookies on cross-site requests too, every state-changing request authenticated by cookie must
 * also carry `x-csrf-token` with the value of the readable `slipstream_csrf` cookie, which is an
 * HMAC of the session secret (double submit, bound to the session). Apps and automation send a
 * bearer device token instead and need no CSRF token.
 */
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/http";
import {
  Authentication,
  csrfCookie,
  csrfHeader,
  csrfSafeMethods,
  CurrentUser,
  sessionCookie,
  Unauthorized,
} from "@slipstream/api";
import { isIP } from "node:net";
import { safeEqual } from "../auth/crypto.ts";
import { Auth, type Principal, type RequestOrigin } from "../auth/service.ts";
import { Signing } from "../auth/signing.ts";
import { ServerConfig } from "../config.ts";

/**
 * The principal the `Authentication` middleware resolved for the current request (its sign-in,
 * device and expiry, beyond the `CurrentUser` the API contract provides). Handlers read it
 * instead of authenticating the credential a second time; outside an authenticated request it
 * is `undefined`.
 */
export const RequestPrincipal = Context.Reference<Principal | undefined>(
  "@slipstream/server/RequestPrincipal",
  { defaultValue: () => undefined },
);

/**
 * The current request's principal; `Unauthorized` on a route the middleware does not guard,
 * which is a wiring mistake that answers like a missing sign-in.
 */
export const currentPrincipal: Effect.Effect<Principal, Unauthorized> = Effect.flatMap(
  RequestPrincipal,
  (principal) =>
    principal === undefined ? Effect.fail(new Unauthorized()) : Effect.succeed(principal),
);

/** Runs `handler` as `principal`: its user as `CurrentUser`, the rest as `RequestPrincipal`. */
const asPrincipal = <A, E, R>(handler: Effect.Effect<A, E, R>, principal: Principal) =>
  handler.pipe(
    Effect.provideService(CurrentUser, principal.user),
    Effect.provideService(RequestPrincipal, principal),
  );

/** The client address, after trusted-proxy handling; "unknown" when the transport has none. */
export const clientAddress = HttpServerRequest.HttpServerRequest.use((request) =>
  Effect.succeed(Option.getOrElse(request.remoteAddress, () => "unknown")),
);

const privateV4: ReadonlyArray<readonly [number, number]> = [
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0x0a000000, 8], // 10.0.0.0/8
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local
  [0x64400000, 10], // 100.64.0.0/10 carrier-grade NAT (Tailscale and friends)
];

const v4Number = (address: string): number =>
  address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);

/**
 * Whether a client address is on the household's network: loopback, private, link-local or
 * unique-local. Everything else came from outside, through the reverse proxy.
 */
export const isHomeAddress = (address: string): boolean => {
  const mapped = address.toLowerCase().replace(/^::ffff:/u, "");
  if (isIP(mapped) === 4) {
    const value = v4Number(mapped);
    return privateV4.some(([network, bits]) => value >>> (32 - bits) === network >>> (32 - bits));
  }
  if (isIP(mapped) === 6) {
    return (
      mapped === "::1" || /^f[cd][0-9a-f]{2}:/u.test(mapped) || /^fe[89ab][0-9a-f]:/u.test(mapped)
    );
  }
  return false;
};

/** Where the current request came from, after trusted-proxy handling. */
export const requestOrigin: Effect.Effect<
  RequestOrigin,
  never,
  HttpServerRequest.HttpServerRequest
> = Effect.map(clientAddress, (address) => (isHomeAddress(address) ? "home" : "away"));

/** The session secret a request carries: the cookie, else the bearer token. */
export const requestCredential = HttpServerRequest.HttpServerRequest.use((request) => {
  const fromCookie = request.cookies[sessionCookie];
  if (fromCookie !== undefined && fromCookie !== "") return Effect.succeed(fromCookie);
  const authorization = request.headers["authorization"] ?? "";
  return Effect.succeed(/^bearer /i.test(authorization) ? authorization.slice(7).trim() : "");
});

const secureCookies = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const request = yield* HttpServerRequest.HttpServerRequest;
  return config.publicUrl?.startsWith("https://") === true || request.protocol === "https";
});

/** Sets the session and CSRF cookies on the response of the current request. */
export const setSessionCookies = (cookie: {
  readonly token: string;
  readonly csrf: string;
  readonly expiresAt: number;
}) =>
  Effect.gen(function* () {
    const secure = yield* secureCookies;
    const common = {
      path: "/",
      sameSite: "lax" as const,
      secure,
      expires: new Date(cookie.expiresAt),
    };
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      HttpServerResponse.setCookie(response, sessionCookie, cookie.token, {
        ...common,
        httpOnly: true,
      }).pipe(
        Effect.flatMap((next) =>
          HttpServerResponse.setCookie(next, csrfCookie, cookie.csrf, common),
        ),
        Effect.orDie,
      ),
    );
  });

/** Sets only the readable CSRF cookie on the response of the current request. */
const setCsrfCookie = (csrf: string, expiresAt: number) =>
  Effect.gen(function* () {
    const secure = yield* secureCookies;
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      HttpServerResponse.setCookie(response, csrfCookie, csrf, {
        path: "/",
        sameSite: "lax",
        secure,
        expires: new Date(expiresAt),
      }).pipe(Effect.orDie),
    );
  });

/** Expires both cookies on the response of the current request. */
export const clearSessionCookies = Effect.gen(function* () {
  const secure = yield* secureCookies;
  yield* HttpEffect.appendPreResponseHandler((_request, response) =>
    HttpServerResponse.expireCookie(response, sessionCookie, {
      path: "/",
      secure,
      httpOnly: true,
    }).pipe(
      Effect.flatMap((next) =>
        HttpServerResponse.expireCookie(next, csrfCookie, { path: "/", secure }),
      ),
      Effect.orDie,
    ),
  );
});

/** Server side of the `Authentication` middleware. */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const auth = yield* Auth;
    const signing = yield* Signing;
    const config = yield* ServerConfig;
    return Authentication.of({
      cookie: (handler, { credential, endpoint }) =>
        Effect.gen(function* () {
          const token = Redacted.value(credential);
          const principal = yield* auth.authenticate(token, yield* requestOrigin);
          const request = yield* HttpServerRequest.HttpServerRequest;
          const csrf = signing.csrfFor(token);
          // The CSRF cookie follows the session token: a missing or outdated one is set again.
          if (!safeEqual(request.cookies[csrfCookie] ?? "", csrf)) {
            yield* Effect.provideService(
              setCsrfCookie(csrf, principal.expiresAt),
              ServerConfig,
              config,
            );
          }
          if (!csrfSafeMethods.has(endpoint.method)) {
            const sent = request.headers[csrfHeader] ?? "";
            if (!safeEqual(sent, csrf)) {
              yield* Effect.logWarning("Rejected a cookie request without a valid CSRF token").pipe(
                Effect.annotateLogs({ method: endpoint.method, path: endpoint.path }),
              );
              return yield* new Unauthorized();
            }
          }
          return yield* asPrincipal(handler, principal);
        }),
      bearer: (handler, { credential }) =>
        requestOrigin.pipe(
          Effect.flatMap((origin) => auth.authenticate(Redacted.value(credential), origin)),
          Effect.flatMap((principal) => asPrincipal(handler, principal)),
        ),
    });
  }),
);
