import type { Collection } from "@slipstream/domain";
import { Effect } from "effect";
import { Api } from "../../api/client.ts";

/* The one write only the series editor makes; its reads are shared (`rulePreview`). */

/** The editor's writes, as effects for `runAction`. */
export const editorActions = {
  /** "New collection…" in Goes to: a collection of its own (`newSeriesCollection`). */
  createCollection: (input: Omit<Collection, "id" | "follows">) =>
    Effect.flatMap(Api, (api) => api.collections.create({ payload: input })),
};
