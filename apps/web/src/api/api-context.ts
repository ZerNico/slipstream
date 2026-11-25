import { createContext } from "react";
import type { Api } from "./client.ts";
import type { Queries } from "./queries.ts";

/** What `ApiProvider` hands down: the bridge and its read options. */
export interface ApiContextValue {
  readonly api: Api;
  readonly queries: Queries;
}

/** Filled by `ApiProvider`; read through the hooks in hooks.ts. */
export const ApiContext = createContext<ApiContextValue | null>(null);
