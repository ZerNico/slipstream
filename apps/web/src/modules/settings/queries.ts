import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  GuestInviteInput,
  GuestUpdate,
  ProfileInput,
  ProfileUpdate,
  RecordingSettings,
} from "@slipstream/api";
import type { InviteId, LiveKeep, Pin, UserId } from "@slipstream/domain";
import { useApi } from "~/api/hooks.ts";
import { keys } from "~/api/queries.ts";
import { guestWriteKey, profileWriteKey } from "./write-keys.ts";

/*
 * The writes of the settings screens. Their reads are the shared queries
 * (`profiles`, `guests`, `invites`, `recordingSettings`, ...) in `~/api/queries.ts`.
 */

/** Adds a household profile (admin). */
export const useCreateProfile = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationKey: profileWriteKey,
    mutationFn: (input: ProfileInput) => api.call((c) => c.profiles.create({ payload: input })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.household }),
  });
};

/**
 * Changes a profile: name, avatar and password (anyone, their own), role, access and other
 * people's passwords (admin).
 */
export const useUpdateProfile = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationKey: profileWriteKey,
    mutationFn: (input: { readonly id: UserId; readonly update: ProfileUpdate }) =>
      api.call((c) => c.profiles.update({ params: { userId: input.id }, payload: input.update })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.household }),
        client.invalidateQueries({ queryKey: keys.me }),
      ]),
  });
};

/** Deletes a profile or guest and signs out its devices (admin). */
export const useRemoveProfile = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: UserId) => api.call((c) => c.profiles.remove({ params: { userId: id } })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.household }),
        client.invalidateQueries({ queryKey: keys.devices }),
      ]),
  });
};

/** Sets or removes a profile's PIN. */
export const useSetPin = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationKey: profileWriteKey,
    mutationFn: (input: {
      readonly id: UserId;
      readonly pin: Pin | null;
      readonly currentPin?: string;
    }) =>
      api.call((c) =>
        c.profiles.setPin({
          params: { userId: input.id },
          payload: {
            pin: input.pin,
            ...(input.currentPin === undefined ? {} : { currentPin: input.currentPin }),
          },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.household }),
  });
};

/**
 * Switches this browser to another household profile. Everything cached belongs to the
 * profile that was active, so only sign-in state survives (SPEC 7.8: a switch re-selects
 * everything).
 */
export const useSwitchProfile = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly id: UserId; readonly secret?: string }) =>
      api.call((c) =>
        c.profiles.switch({
          params: { userId: input.id },
          payload: input.secret === undefined ? {} : { secret: input.secret },
        }),
      ),
    onSuccess: (result) => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
      client.setQueryData(keys.me, result.user);
    },
  });
};

/** Invites a guest by link (admin). */
export const useInviteGuest = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationKey: guestWriteKey,
    mutationFn: (input: GuestInviteInput) => api.call((c) => c.guests.invite({ payload: input })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.invites }),
  });
};

/** Withdraws a pending invite (admin). */
export const useRevokeInvite = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: InviteId) =>
      api.call((c) => c.guests.revokeInvite({ params: { inviteId: id } })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.invites }),
  });
};

/** Changes what a guest may see and do (admin). */
export const useUpdateGuest = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationKey: guestWriteKey,
    mutationFn: (input: { readonly id: UserId; readonly update: GuestUpdate }) =>
      api.call((c) => c.guests.update({ params: { userId: input.id }, payload: input.update })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.guests }),
  });
};

/** Saves the recording defaults (admin). Changing a default never rewrites existing rules. */
export const useSaveRecordingSettings = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: RecordingSettings) =>
      api.call((c) => c.settings.saveRecording({ payload: settings })),
    onSuccess: (settings) => client.setQueryData(keys.recordingSettings, settings),
  });
};

/** Saves how long live TV keeps running and its rewind buffer after viewers leave (admin). */
export const useSaveLiveSettings = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: LiveKeep) => api.call((c) => c.settings.saveLive({ payload: settings })),
    onSuccess: (settings) => client.setQueryData(keys.liveSettings, settings),
  });
};

/** Connects TMDB with a key, or disconnects it with `null` (admin). */
export const useSaveArtworkSettings = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tmdbKey: string | null) =>
      api.call((c) => c.settings.saveArtwork({ payload: { tmdbKey } })),
    onSuccess: (settings) => client.setQueryData(keys.artworkSettings, settings),
  });
};
