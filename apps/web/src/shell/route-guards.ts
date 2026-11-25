import type { QueryClient } from "@tanstack/react-query";
import { type ParsedLocation, redirect } from "@tanstack/react-router";
import type { User } from "@slipstream/domain";
import { isUnauthorized } from "~/api/errors.ts";
import type { Queries } from "~/api/queries.ts";

/** What every route's `beforeLoad` gets from the router. */
export interface RouterContext {
  readonly queryClient: QueryClient;
  readonly queries: Queries;
}

const setupRequired = async ({ queryClient, queries }: RouterContext): Promise<boolean> =>
  (await queryClient.ensureQueryData(queries.setupStatus())).required;

/** A fresh server goes to first-run setup before anything else. */
export const requireSetupDone = async (context: RouterContext): Promise<void> => {
  if (await setupRequired(context)) throw redirect({ to: "/setup" });
};

/** Setup runs once: on a server that is set up, people sign in instead. */
export const requireSetupPending = async (context: RouterContext): Promise<void> => {
  if (!(await setupRequired(context))) throw redirect({ to: "/login" });
};

/**
 * The signed-in person, or sign-in first with the way back to `location`. Any other failure
 * is the route's error.
 */
export const requireSession = async (
  { queryClient, queries }: RouterContext,
  location: ParsedLocation,
): Promise<{ readonly me: User }> => {
  try {
    return { me: await queryClient.ensureQueryData(queries.me()) };
  } catch (error) {
    if (isUnauthorized(error))
      throw redirect({ to: "/login", search: { redirect: location.href } });
    throw error;
  }
};
