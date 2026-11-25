import { Context } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";
import type { User } from "@slipstream/domain";
import { Unauthorized } from "./errors.ts";

/** The signed-in user, provided to handlers by the `Authentication` middleware. */
export class CurrentUser extends Context.Service<CurrentUser, User>()(
  "@slipstream/api/CurrentUser",
) {}

/** Name of the HTTP-only session cookie the web UI uses. */
export const sessionCookie = "slipstream_session";

/**
 * Name of the readable cookie holding the CSRF token bound to the browser session. The server
 * sets it beside {@link sessionCookie}; the web client copies its value into {@link csrfHeader}.
 */
export const csrfCookie = "slipstream_csrf";

/**
 * Header that must carry the {@link csrfCookie} value on every state-changing request that
 * authenticates by cookie. Requests with a bearer device token need none.
 */
export const csrfHeader = "x-csrf-token";

/** The methods that change nothing, so they need no {@link csrfHeader}. */
export const csrfSafeMethods: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Authenticates a request by session cookie (web) or bearer device token (app, automation).
 * The server implements it; clients send the cookie automatically or attach the token.
 */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser; requires: never }
>()("@slipstream/api/Authentication", {
  security: {
    cookie: HttpApiSecurity.apiKey({ key: sessionCookie, in: "cookie" }),
    bearer: HttpApiSecurity.bearer,
  },
  error: Unauthorized,
}) {}
