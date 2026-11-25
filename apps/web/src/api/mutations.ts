import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ChannelUpdate,
  CollectionInput,
  CollectionUpdate,
  DeviceCodeApproval,
  LoginRequest,
  PlaybackSettings,
  RecordingRequest,
  RecordingUpdate,
  RuleCollectionRequest,
  RuleInput,
  RuleUpdate,
  SetupRequest,
} from "@slipstream/api";
import type {
  ChannelId,
  CollectionId,
  DeviceId,
  PlaybackTarget,
  RecordingId,
  RuleId,
  SourceId,
  SourceInput,
  SourceUpdate,
} from "@slipstream/domain";
import { useApi } from "./hooks.ts";
import { invalidateFor } from "./invalidation.ts";
import { keys } from "./queries.ts";

/*
 * Every write the web makes. Each hook refetches what its change reaches ({@link invalidateFor},
 * the same table the live events use), so lists, counts and badges catch up without a reload.
 */

/** First-run setup: creates the admin and signs them in. */
export const useSetup = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SetupRequest) => api.call((c) => c.auth.setup({ payload: request })),
    onSuccess: (result) => {
      client.setQueryData(keys.setup, { required: false });
      client.setQueryData(keys.me, result.user);
    },
  });
};

/** Username and password; the server sets the session cookie. */
export const useLogin = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: LoginRequest) => api.call((c) => c.auth.login({ payload: request })),
    onSuccess: (result) => {
      // A different person may sign in on this browser: nothing cached may carry over.
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
      client.setQueryData(keys.me, result.user);
    },
  });
};

/** Ends the session and forgets everything cached for it. */
export const useLogout = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.call((c) => c.auth.logout()),
    onSettled: () => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
      client.removeQueries({ queryKey: keys.me });
    },
  });
};

/**
 * Approves or blocks a TV's device code. `userId` signs the TV in as another household
 * profile (admins only); without it the TV gets the signed-in person.
 */
export const useApproveDevice = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (approval: DeviceCodeApproval) =>
      api.call((c) => c.auth.approveDeviceCode({ payload: approval })),
    onSuccess: () => invalidateFor(client, "devices"),
  });
};

/** Turns a collection suggestion into a collection (admin). */
export const useCreateCollection = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CollectionInput) =>
      api.call((c) => c.collections.create({ payload: input })),
    onSuccess: () => invalidateFor(client, "collections"),
  });
};

/**
 * "Also move similar ones": widens the collection's matcher so recordings like this one land
 * there from now on, past and future (admin).
 */
export const useMoveSimilar = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly collectionId: CollectionId;
      readonly recordingId: RecordingId;
    }) =>
      api.call((c) =>
        c.collections.moveSimilar({
          params: { collectionId: input.collectionId },
          payload: { recordingId: input.recordingId },
        }),
      ),
    onSuccess: () => invalidateFor(client, "collections"),
  });
};

/**
 * Creates a collection, or saves changes to one (admin). A change to a collection that follows
 * a series recording leaves its conditions out (the server refuses them with `followsRule`).
 */
export const useSaveCollection = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { readonly id: CollectionId; readonly collection: CollectionUpdate }
        | { readonly id?: undefined; readonly collection: CollectionInput },
    ) =>
      input.id === undefined
        ? api.call((c) => c.collections.create({ payload: input.collection }))
        : api.call((c) =>
            c.collections.update({
              params: { collectionId: input.id },
              payload: input.collection,
            }),
          ),
    onSuccess: () => invalidateFor(client, "collections"),
  });
};

/**
 * Deletes a collection (admin). Its recordings stay and group automatically again; a series
 * recording that recorded into it keeps recording.
 */
export const useDeleteCollection = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: CollectionId) =>
      api.call((c) => c.collections.remove({ params: { collectionId: id } })),
    onSuccess: () => invalidateFor(client, "collections"),
  });
};

/** Records a guide programme or a manual range. */
export const useCreateRecording = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: RecordingRequest) =>
      api.call((c) => c.recordings.create({ payload: request })),
    onSuccess: () => invalidateFor(client, "recording"),
  });
};

/** Protects, relabels, re-pins or extends a recording. */
export const useUpdateRecording = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly id: RecordingId; readonly update: RecordingUpdate }) =>
      api.call((c) =>
        c.recordings.update({ params: { recordingId: input.id }, payload: input.update }),
      ),
    onSuccess: (entry) => {
      client.setQueryData(keys.recording(entry.id), entry);
      return invalidateFor(client, "recording");
    },
  });
};

/** Stops a running recording early. */
export const useStopRecording = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: RecordingId) =>
      api.call((c) => c.recordings.stop({ params: { recordingId: id } })),
    onSuccess: () => invalidateFor(client, "recording"),
  });
};

/** What deleting a recording asks for, beside the recording. */
export interface DeleteRecordingInput {
  readonly id: RecordingId;
  /** "Delete, record it again when repeated": no episode history row. */
  readonly history?: "skip" | undefined;
  /** "Delete and stop looking for a repeat" for a damaged recording. */
  readonly rerun?: "stop" | undefined;
}

/** Deletes a recording, or cancels a scheduled one. */
export const useDeleteRecording = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, history, rerun }: DeleteRecordingInput) =>
      api.call((c) =>
        c.recordings.remove({
          params: { recordingId: id },
          query: {
            ...(history === undefined ? {} : { history }),
            ...(rerun === undefined ? {} : { rerun }),
          },
        }),
      ),
    onSuccess: () => invalidateFor(client, "recordingRemoved"),
  });
};

/** "Keep the original": shows a replaced damaged recording again beside its repeat. */
export const useKeepOriginal = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: RecordingId) =>
      api.call((c) => c.recordings.keepOriginal({ params: { recordingId: id } })),
    onSuccess: (entry) => {
      client.setQueryData(keys.recording(entry.id), entry);
      return invalidateFor(client, "recording");
    },
  });
};

/** Creates a rule, or saves changes to one. */
export const useSaveRule = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { readonly id: RuleId; readonly update: RuleUpdate }
        | { readonly id?: undefined; readonly rule: RuleInput },
    ) =>
      input.id === undefined
        ? api.call((c) => c.rules.create({ payload: input.rule }))
        : api.call((c) => c.rules.update({ params: { ruleId: input.id }, payload: input.update })),
    onSuccess: (rule) => {
      client.setQueryData(keys.rule(rule.id), rule);
      return invalidateFor(client, "rules");
    },
  });
};

/** What deleting a series recording asks for, beside the rule. */
export interface DeleteRuleInput {
  readonly id: RuleId;
  /** A collection that follows it: keep it with today's conditions (default) or remove it. */
  readonly collection?: "keep" | "remove" | undefined;
  /** Undo right after "Record series": also takes back what creating it did. */
  readonly undo?: boolean | undefined;
}

/** Deletes a rule. Recordings it made stay. */
export const useDeleteRule = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, collection, undo }: DeleteRuleInput) =>
      api.call((c) =>
        c.rules.remove({
          params: { ruleId: id },
          query: {
            ...(collection === undefined ? {} : { collection }),
            ...(undo === undefined ? {} : { undo }),
          },
        }),
      ),
    onSuccess: () => invalidateFor(client, "rules"),
  });
};

/** "No thanks" to grouping a series recording's programmes: never offered again for it. */
export const useDeclineOffer = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: RuleId) => api.call((c) => c.rules.declineOffer({ params: { ruleId: id } })),
    onSuccess: (rule) => {
      client.setQueryData(keys.rule(rule.id), rule);
      return invalidateFor(client, "rules");
    },
  });
};

/** "Group them": a collection that follows the series recording, which records into it. */
export const useCreateSeriesCollection = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly ruleId: RuleId; readonly request: RuleCollectionRequest }) =>
      api.call((c) => c.rules.group({ params: { ruleId: input.ruleId }, payload: input.request })),
    onSuccess: () => invalidateFor(client, "rules"),
  });
};

/** Undo of "Group them": deletes the linked collection; the offer stays available. */
export const useUndoSeriesCollection = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: RuleId) => api.call((c) => c.rules.ungroup({ params: { ruleId: id } })),
    onSuccess: () => invalidateFor(client, "rules"),
  });
};

/** "Forget them": deleted episodes of this series recording are recorded again when repeated. */
export const useForgetHistory = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: RuleId) => api.call((c) => c.rules.forgetHistory({ params: { ruleId: id } })),
    onSuccess: (history, id) => {
      client.setQueryData(keys.ruleHistory(id), history);
      return invalidateFor(client, "rules");
    },
  });
};

/** "Use its own conditions instead": a linked collection stops following its series recording. */
export const useUnlinkCollection = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: CollectionId) =>
      api.call((c) => c.collections.unlink({ params: { collectionId: id } })),
    onSuccess: () => invalidateFor(client, "rules"),
  });
};

/** Adds a source. */
export const useCreateSource = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceInput) => api.call((c) => c.sources.create({ payload: input })),
    onSuccess: () => invalidateFor(client, "sources"),
  });
};

/** Changes a source, e.g. pauses it or sets its stream limit. */
export const useUpdateSource = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly id: SourceId; readonly update: SourceUpdate }) =>
      api.call((c) => c.sources.update({ params: { sourceId: input.id }, payload: input.update })),
    onSuccess: () => invalidateFor(client, "sources"),
  });
};

/** Fetches a source's playlist and guide now. */
export const useRefreshSource = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: SourceId) => api.call((c) => c.sources.refresh({ params: { sourceId: id } })),
    onSuccess: () => invalidateFor(client, "sources", "guide"),
  });
};

/** Tries a source's settings before saving them ("Test source"). */
export const useTestSource = () => {
  const api = useApi();
  return useMutation({
    mutationFn: (input: SourceInput) => api.call((c) => c.sources.test({ payload: input })),
  });
};

/** Changes a channel: name, number, hidden, favourite. */
export const useUpdateChannel = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { readonly id: ChannelId; readonly update: ChannelUpdate }) =>
      api.call((c) =>
        c.channels.update({ params: { channelId: input.id }, payload: input.update }),
      ),
    onSuccess: () => invalidateFor(client, "channels"),
  });
};

/** Signs a device out for good. */
export const useRevokeDevice = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: DeviceId) => api.call((c) => c.devices.revoke({ params: { deviceId: id } })),
    onSuccess: () => invalidateFor(client, "devices"),
  });
};

/** Saves playback and conversion defaults. */
export const useSavePlaybackSettings = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: PlaybackSettings) =>
      api.call((c) => c.settings.savePlayback({ payload: settings })),
    onSuccess: (settings) => client.setQueryData(keys.playbackSettings, settings),
  });
};

/** Stores the resume position; the next session on any device starts there. */
export const useSaveProgress = () => {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly target: PlaybackTarget;
      readonly positionMillis: number;
      readonly watched: boolean;
    }) => api.call((c) => c.playback.saveState({ payload: input })),
    onSuccess: (state) => {
      if (state.target._tag === "Recording") {
        client.setQueryData(keys.playbackState(state.target.recordingId), state);
      }
      return invalidateFor(client, "progress");
    },
  });
};
