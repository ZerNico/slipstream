import { Effect } from "effect";
import { type Api, type ApiRuntime, isUnauthorized } from "./client.ts";

/**
 * Runs one API write (`apiActions`) on a connection's runtime. When the server refuses the
 * token (`Unauthorized`: revoked, expired or the profile deleted), `onUnauthorized` hears of it
 * before the promise rejects, as the query cache does for reads, so a 401 on a write signs the
 * profile out too.
 */
export const runAction = <A, E>(
  runtime: ApiRuntime,
  effect: Effect.Effect<A, E, Api>,
  onUnauthorized: () => void,
): Promise<A> =>
  runtime.runPromise(
    effect.pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (isUnauthorized(error)) onUnauthorized();
        }),
      ),
    ),
  );
