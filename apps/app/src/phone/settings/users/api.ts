import type { GuestInviteInput, GuestUpdate, ProfileInput, ProfileUpdate } from "@slipstream/api";
import type { InviteId, Pin, UserId } from "@slipstream/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { Platform, Share } from "react-native";
import { Api } from "../../../api/client.ts";
import { queryKeys } from "../../../api/keys.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useSession } from "../../../session/session-context.ts";

/* The writes of Settings › Users & devices and Your profile on a phone; their reads are shared. */

/** The writes these screens make, as effects for `runAction`. */
export const usersActions = {
  createProfile: (input: ProfileInput) =>
    Effect.flatMap(Api, (api) => api.profiles.create({ payload: input })),
  updateProfile: (userId: UserId, update: ProfileUpdate) =>
    Effect.flatMap(Api, (api) => api.profiles.update({ params: { userId }, payload: update })),
  /** Deletes a profile or guest and signs out its devices. */
  removeProfile: (userId: UserId) =>
    Effect.flatMap(Api, (api) => api.profiles.remove({ params: { userId } })),
  /** Sets (`pin`) or removes (`null`) a PIN; someone changing their own sends the current one. */
  setPin: (userId: UserId, change: { readonly pin: Pin | null; readonly currentPin?: string }) =>
    Effect.flatMap(Api, (api) =>
      api.profiles.setPin({
        params: { userId },
        payload: {
          pin: change.pin,
          ...(change.currentPin === undefined ? {} : { currentPin: change.currentPin }),
        },
      }),
    ),
  inviteGuest: (input: GuestInviteInput) =>
    Effect.flatMap(Api, (api) => api.guests.invite({ payload: input })),
  revokeInvite: (inviteId: InviteId) =>
    Effect.flatMap(Api, (api) => api.guests.revokeInvite({ params: { inviteId } })),
  updateGuest: (userId: UserId, update: GuestUpdate) =>
    Effect.flatMap(Api, (api) => api.guests.update({ params: { userId }, payload: update })),
};

/**
 * Reads everything a write here may have changed again: the household, guests, invites and the
 * caller's own profile. The household goes to the session too, so names, roles and PINs on
 * "Who's watching?" follow at once.
 */
export const useRefreshHousehold = () => {
  const client = useQueryClient();
  const queries = useApiQueries();
  const { syncHousehold } = useSession();
  return async (): Promise<void> => {
    // `profiles` covers the caller's own profile (`myProfile`), `guests` the invites.
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.profiles }),
      client.invalidateQueries({ queryKey: queryKeys.guests }),
      client.invalidateQueries({ queryKey: queryKeys.me }),
    ]);
    const household = await client.fetchQuery(queries.profiles()).catch(() => undefined);
    if (household !== undefined) syncHousehold(household);
  };
};

/**
 * Opens the system share sheet with an invite link (Messages, mail, Copy). iOS shares the link
 * as a URL, Android as the text; a dismissed sheet is not a failure.
 */
export const shareLink = async (url: string): Promise<void> => {
  await Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch(() => undefined);
};
