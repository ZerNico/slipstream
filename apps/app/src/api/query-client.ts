import { QueryCache, QueryClient } from "@tanstack/react-query";
import { Predicate } from "effect";
import { isUnauthorized } from "./client.ts";

/**
 * Carries "the server refused the token" from the query cache, made before the session exists,
 * to the session below it. One listener: the profile whose token the queries send.
 */
export interface UnauthorizedSignal {
  readonly emit: () => void;
  /** Sets the listener; the returned function removes it again. */
  readonly listen: (listener: () => void) => () => void;
}

/** A signal without a listener yet. */
export const makeUnauthorizedSignal = (): UnauthorizedSignal => {
  let current: (() => void) | undefined;
  return {
    emit: () => current?.(),
    listen: (listener) => {
      current = listener;
      return () => {
        if (current === listener) current = undefined;
      };
    },
  };
};

/**
 * The app's query cache. A query the server answers with `Unauthorized` (the device token was
 * revoked or has expired) is not retried and tells `unauthorized`, so the session forgets the
 * profile; `Forbidden` (a read only admins may make) is not retried either, asking again cannot
 * change it; other failures are asked again twice. Queries cancelled by a profile switch never
 * reach `onError` (TanStack drops silent cancels), so a late 401 cannot hit the next profile.
 */
export const makeQueryClient = (unauthorized: UnauthorizedSignal): QueryClient =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorized(error)) unauthorized.emit();
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          !isUnauthorized(error) && !Predicate.isTagged(error, "Forbidden") && failures < 2,
        staleTime: 30_000,
      },
    },
  });
