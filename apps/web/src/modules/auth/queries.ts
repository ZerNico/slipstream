import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChannelId } from "@slipstream/domain";
import { useApi } from "~/api/hooks.ts";
import { keys } from "~/api/queries.ts";

/** Accepts a guest invite: creates the account and signs it in. */
export const useAcceptInvite = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly token: string;
      readonly username: string;
      readonly password: string;
      readonly displayName?: string;
    }) => api.call((c) => c.invites.accept({ payload: input })),
    onSuccess: (result) => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
      client.setQueryData(keys.me, result.user);
    },
  });
};

/**
 * Hides the channels left out in setup, all at once. Answers how many could not be hidden, and
 * refreshes the channels and the guide once at the end instead of once per channel.
 */
export const useHideChannels = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly ChannelId[]): Promise<number> => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          api.call((c) =>
            c.channels.update({ params: { channelId: id }, payload: { hidden: true } }),
          ),
        ),
      );
      return results.filter((result) => result.status === "rejected").length;
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.channels }),
        client.invalidateQueries({ queryKey: keys.guide }),
      ]),
  });
};
