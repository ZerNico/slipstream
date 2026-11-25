import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/keys.ts";

/**
 * Refreshes what a source or channel change touches: the sources, every channel list, and the
 * guide.
 */
export const useRefreshAfterChange = () => {
  const client = useQueryClient();
  return (what: "sources" | "channels") =>
    Promise.all([
      what === "sources"
        ? client.invalidateQueries({ queryKey: queryKeys.sources })
        : Promise.resolve(),
      client.invalidateQueries({ queryKey: queryKeys.channels }),
      client.invalidateQueries({ queryKey: queryKeys.guideAll }),
    ]);
};
