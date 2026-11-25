import { Effect } from "effect";
import type { HttpClient } from "effect/http";
import { Api, type Connection } from "../api/client.ts";
import { apiActions } from "../api/queries.ts";

/** How long signing out waits for the server before giving up on revoking the token. */
export const LOGOUT_TIMEOUT = "5 seconds";

/**
 * Revokes the device token on the server. It runs on its own layer for `connection`, not on the
 * session's runtime: signing out disposes that runtime straight away, which would interrupt the
 * request. Best effort: signing out locally works offline too, so this never fails.
 */
export const revokeToken = (
  connection: Connection,
): Effect.Effect<void, never, HttpClient.HttpClient> =>
  apiActions.logout.pipe(
    Effect.provide(Api.layerOver(connection)),
    Effect.timeout(LOGOUT_TIMEOUT),
    Effect.ignore,
  );
