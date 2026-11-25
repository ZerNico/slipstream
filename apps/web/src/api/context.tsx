import { useState, type ReactNode } from "react";
import { ApiContext } from "./api-context.ts";
import type { Api } from "./client.ts";
import { createQueries, type Queries } from "./queries.ts";

/**
 * Makes an {@link Api} and its queries available to the tree below. Pass the same `queries`
 * the router context holds, so loaders and screens share one set.
 */
export function ApiProvider({
  api,
  queries,
  children,
}: {
  api: Api;
  queries?: Queries;
  children: ReactNode;
}) {
  const [value] = useState(() => ({ api, queries: queries ?? createQueries(api) }));
  return <ApiContext value={value}>{children}</ApiContext>;
}
