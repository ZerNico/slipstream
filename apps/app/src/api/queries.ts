import type {
  DeviceCodeApproval,
  PlaybackProgress,
  PlaybackSessionRequest,
  PlaybackSessionUpdate,
  RecordingRequest,
  RecordingUpdate,
  RuleCollectionRequest,
  RuleInput,
  RuleUpdate,
} from "@slipstream/api";
import type {
  ChannelId,
  PlaybackSessionId,
  ProgrammeId,
  RecordingId,
  RuleId,
  SourceId,
  UserId,
} from "@slipstream/domain";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { DateTime, Effect } from "effect";
import { Api, type ApiRuntime } from "./client.ts";
import { queryKeys, type QueryKey } from "./keys.ts";

/**
 * Query options for one API read: the effect runs on the connection's runtime, and TanStack
 * Query's abort signal interrupts it (and with it the HTTP request) when the query is cancelled.
 */
const apiQuery = <A, E>(
  runtime: ApiRuntime,
  queryKey: QueryKey,
  effect: Effect.Effect<A, E, Api>,
  staleTime?: number,
) =>
  queryOptions({
    queryKey,
    queryFn: ({ signal }) => runtime.runPromise(effect, { signal }),
    ...(staleTime === undefined ? {} : { staleTime }),
  });

/** Query options for every read the app makes, bound to one connection's runtime. */
export const apiQueries = (runtime: ApiRuntime) => ({
  channels: () =>
    apiQuery(
      runtime,
      queryKeys.channels,
      Effect.flatMap(Api, (api) => api.channels.list({ query: {} })),
      5 * 60_000,
    ),
  guide: (from: number, to: number) =>
    apiQuery(
      runtime,
      queryKeys.guide(from, to),
      Effect.flatMap(Api, (api) =>
        api.guide.window({
          query: { from: DateTime.makeUnsafe(from), to: DateTime.makeUnsafe(to) },
        }),
      ),
      10 * 60_000,
    ),
  /** One channel's programmes in a window: the player's Record looks up the playhead's. */
  channelGuide: (channelId: ChannelId | undefined, from: number, to: number) =>
    queryOptions({
      queryKey: queryKeys.channelGuide(channelId ?? "", from, to),
      queryFn:
        channelId === undefined
          ? skipToken
          : ({ signal }) =>
              runtime.runPromise(
                Effect.flatMap(Api, (api) =>
                  api.guide.window({
                    query: {
                      from: DateTime.makeUnsafe(from),
                      to: DateTime.makeUnsafe(to),
                      channels: channelId,
                    },
                  }),
                ),
                { signal },
              ),
      staleTime: 5 * 60_000,
    }),
  /** Where the guide data ends (`GET /guide/extent`): how wide the timeline is. */
  guideExtent: () =>
    apiQuery(
      runtime,
      queryKeys.guideExtent,
      Effect.flatMap(Api, (api) => api.guide.extent()),
      10 * 60_000,
    ),
  /** What airs now and next on each visible channel: Home's On now row. */
  nowNext: () =>
    queryOptions({
      ...apiQuery(
        runtime,
        queryKeys.nowNext,
        Effect.flatMap(Api, (api) => api.guide.nowNext()),
      ),
      // What is on changes on the hour and half hour; a minute is plenty (as on the web).
      refetchInterval: 60_000,
    }),
  /**
   * One programme in full: what a guide entry leaves out (description, pictures), for the TV
   * guide's header and the record sheet. Without an id (nothing focused yet) it waits.
   */
  programme: (programmeId: ProgrammeId | undefined) =>
    queryOptions({
      queryKey: queryKeys.programme(programmeId ?? ""),
      queryFn:
        programmeId === undefined
          ? skipToken
          : ({ signal }) =>
              runtime.runPromise(
                Effect.flatMap(Api, (api) => api.guide.programme({ params: { programmeId } })),
                { signal },
              ),
      staleTime: 10 * 60_000,
    }),
  /**
   * The airings of a window this profile already has (`GET /guide/repeats`): the quiet
   * "already recorded" mark in the guide.
   */
  guideRepeats: (from: number, to: number) =>
    apiQuery(
      runtime,
      queryKeys.guideRepeats(from, to),
      Effect.flatMap(Api, (api) =>
        api.guide.repeats({
          query: { from: DateTime.makeUnsafe(from), to: DateTime.makeUnsafe(to) },
        }),
      ),
    ),
  /**
   * Programmes from now on that match `q`, as the server's full-text search matches them
   * (`GET /guide/search`). TanStack Query's abort signal interrupts the request when a newer
   * query replaces it.
   */
  guideSearch: (q: string) =>
    apiQuery(
      runtime,
      queryKeys.guideSearch(q),
      Effect.flatMap(Api, (api) => api.guide.search({ query: { q } })),
      60_000,
    ),
  /**
   * The library with the caller's `watched` and `positionMillis` on every entry. Screens filter
   * Unwatched locally so home, guide and library share one cached list.
   */
  recordings: () =>
    apiQuery(
      runtime,
      queryKeys.recordings,
      Effect.flatMap(Api, (api) => api.recordings.list({ query: {} })),
    ),
  collections: () =>
    apiQuery(
      runtime,
      queryKeys.collections,
      Effect.flatMap(Api, (api) => api.collections.list()),
      60_000,
    ),
  rules: () =>
    apiQuery(
      runtime,
      queryKeys.rules,
      Effect.flatMap(Api, (api) => api.rules.list()),
    ),
  /** One recording; without an id (the player on live or a captured range) it waits. */
  recording: (id: RecordingId | undefined) =>
    queryOptions({
      queryKey: queryKeys.recording(id ?? ""),
      queryFn:
        id === undefined
          ? skipToken
          : ({ signal }) =>
              runtime.runPromise(
                Effect.flatMap(Api, (api) => api.recordings.get({ params: { recordingId: id } })),
                { signal },
              ),
    }),
  conflicts: (from: number, to: number) =>
    apiQuery(
      runtime,
      queryKeys.conflicts(from, to),
      Effect.flatMap(Api, (api) =>
        api.recordings.conflicts({
          query: { from: DateTime.makeUnsafe(from), to: DateTime.makeUnsafe(to) },
        }),
      ),
    ),
  continueWatching: () =>
    apiQuery(
      runtime,
      queryKeys.continueWatching,
      Effect.flatMap(Api, (api) => api.playback.continueWatching()),
    ),
  /**
   * What the record sheet offers for one programme and this profile: the default extra time and
   * where it comes from, and whether (and for whom) it is already recorded.
   */
  recordOptions: (programmeId: ProgrammeId) =>
    apiQuery(
      runtime,
      queryKeys.recordOptions(programmeId),
      Effect.flatMap(Api, (api) => api.programmes.recordOptions({ params: { programmeId } })),
    ),
  /** The household's profiles, for the TV's picker and for whom a TV signs in as. */
  profiles: () =>
    apiQuery(
      runtime,
      queryKeys.profiles,
      Effect.flatMap(Api, (api) => api.profiles.list()),
      5 * 60_000,
    ),
  /** What this profile may see and record into (SPEC §7.8), for its own profile page and the
   * series editor; the server enforces it too. */
  myProfile: () =>
    apiQuery(
      runtime,
      queryKeys.myProfile,
      Effect.flatMap(Api, (api) => api.profiles.me()),
    ),
  guests: () =>
    apiQuery(
      runtime,
      queryKeys.guests,
      Effect.flatMap(Api, (api) => api.guests.list()),
    ),
  /** The guest invites not yet accepted. */
  invites: () =>
    apiQuery(
      runtime,
      queryKeys.invites,
      Effect.flatMap(Api, (api) => api.guests.invites()),
    ),
  /** The signed-in user, fresh from the server (role changes apply without signing out). */
  me: () =>
    apiQuery(
      runtime,
      queryKeys.me,
      Effect.flatMap(Api, (api) => api.auth.me()),
    ),
  /** System info; the app reads the household's time zone from it. */
  system: () =>
    apiQuery(
      runtime,
      queryKeys.system,
      Effect.flatMap(Api, (api) => api.system.info()),
      5 * 60_000,
    ),
  /** The sources with their stream limits (admins; others get `Forbidden`). */
  sources: () =>
    apiQuery(
      runtime,
      queryKeys.sources,
      Effect.flatMap(Api, (api) => api.sources.list()),
      5 * 60_000,
    ),
  /** What one source offers (its streams), for the count on its card. */
  sourceStreams: (id: SourceId) =>
    apiQuery(
      runtime,
      queryKeys.sourceStreams(id),
      Effect.flatMap(Api, (api) => api.sources.streams({ params: { sourceId: id }, query: {} })),
    ),
  /** Each source's streams in use against its limit. */
  streamsUsage: () =>
    apiQuery(
      runtime,
      queryKeys.streamsUsage,
      Effect.flatMap(Api, (api) => api.streams.list()),
    ),
  /** Every channel, hidden ones too, in channel order. */
  allChannels: () =>
    apiQuery(
      runtime,
      queryKeys.allChannels,
      Effect.flatMap(Api, (api) => api.channels.list({ query: { includeHidden: true } })),
    ),
  /** The household's recording defaults (extra time); the built-in ones apply without them. */
  recordingSettings: () =>
    apiQuery(
      runtime,
      queryKeys.recordingSettings,
      Effect.flatMap(Api, (api) => api.settings.recording()),
      5 * 60_000,
    ),
  /** How long live TV keeps running and its rewind buffer after viewers leave. */
  liveSettings: () =>
    apiQuery(
      runtime,
      queryKeys.liveSettings,
      Effect.flatMap(Api, (api) => api.settings.live()),
      5 * 60_000,
    ),
  artworkSettings: () =>
    apiQuery(
      runtime,
      queryKeys.artworkSettings,
      Effect.flatMap(Api, (api) => api.settings.artwork()),
    ),
  playbackSettings: () =>
    apiQuery(
      runtime,
      queryKeys.playbackSettings,
      Effect.flatMap(Api, (api) => api.settings.playback()),
    ),
  /**
   * What a draft series recording would record over the next days. Typing changes the key on
   * every settled change; the last answer stays on screen meanwhile, so the preview keeps its
   * height.
   */
  rulePreview: (rule: RuleInput, until: number) =>
    queryOptions({
      ...apiQuery(
        runtime,
        queryKeys.rulePreview(JSON.stringify(rule), until),
        Effect.flatMap(Api, (api) =>
          api.rules.preview({ payload: { rule, until: DateTime.makeUnsafe(until) } }),
        ),
      ),
      placeholderData: (previous) => previous,
      retry: false,
    }),
  /** The TV sign-in waiting for this code, so the phone can name the device first. */
  pendingSignIn: (userCode: string) =>
    apiQuery(
      runtime,
      queryKeys.pendingSignIn(userCode),
      Effect.flatMap(Api, (api) => api.auth.pendingDeviceCode({ params: { userCode } })),
    ),
});

/** The writes the app makes, as effects for `runAction` (./actions.ts). */
export const apiActions = {
  recordProgramme: (request: RecordingRequest) =>
    Effect.flatMap(Api, (api) => api.recordings.create({ payload: request })),
  /** "Record series" / "Record every…": creates the series recording. */
  createRule: (rule: RuleInput) =>
    Effect.flatMap(Api, (api) => api.rules.create({ payload: rule })),
  /** Changes a series recording: here, switching it on or off. */
  updateRule: (ruleId: RuleId, update: RuleUpdate) =>
    Effect.flatMap(Api, (api) => api.rules.update({ params: { ruleId }, payload: update })),
  /**
   * Deletes a series recording; `undo` (the sheet's Undo right after creating it) also takes
   * back what it scheduled, within the server's undo window.
   */
  deleteRule: (ruleId: RuleId, options: { readonly undo?: boolean } = {}) =>
    Effect.flatMap(Api, (api) =>
      api.rules.remove({
        params: { ruleId },
        query: options.undo === undefined ? {} : { undo: options.undo },
      }),
    ),
  /** Whether a series recording's programmes scatter, so the sheet offers to group them. */
  ruleOffer: (ruleId: RuleId) =>
    Effect.flatMap(Api, (api) => api.rules.offer({ params: { ruleId } })),
  /** "Group them": a collection that follows the series recording. */
  groupRule: (ruleId: RuleId, request: RuleCollectionRequest) =>
    Effect.flatMap(Api, (api) => api.rules.group({ params: { ruleId }, payload: request })),
  /** Undo of "Group them": removes that collection again, without declining the offer. */
  ungroupRule: (ruleId: RuleId) =>
    Effect.flatMap(Api, (api) => api.rules.ungroup({ params: { ruleId } })),
  updateRecording: (recordingId: RecordingId, update: RecordingUpdate) =>
    Effect.flatMap(Api, (api) =>
      api.recordings.update({ params: { recordingId }, payload: update }),
    ),
  /** Ends a running recording now (the player's Stop recording). */
  stopRecording: (recordingId: RecordingId) =>
    Effect.flatMap(Api, (api) => api.recordings.stop({ params: { recordingId } })),
  /** "Skip this one": removes a scheduled recording from the schedule. */
  deleteRecording: (recordingId: RecordingId) =>
    Effect.flatMap(Api, (api) => api.recordings.remove({ params: { recordingId }, query: {} })),
  /** Checks a profile's PIN; run it on that profile's own runtime. */
  verifyPin: (userId: UserId, pin: string) =>
    Effect.flatMap(Api, (api) => api.profiles.verifyPin({ params: { userId }, payload: { pin } })),
  startPlayback: (request: PlaybackSessionRequest) =>
    Effect.flatMap(Api, (api) => api.playback.createSession({ payload: request })),
  /** Tells the server about a new speed (surround turns stereo above 1×) or quality. */
  updatePlayback: (playbackSessionId: PlaybackSessionId, update: PlaybackSessionUpdate) =>
    Effect.flatMap(Api, (api) =>
      api.playback.updateSession({ params: { playbackSessionId }, payload: update }),
    ),
  endPlayback: (playbackSessionId: PlaybackSessionId) =>
    Effect.flatMap(Api, (api) => api.playback.endSession({ params: { playbackSessionId } })),
  /** Stores this profile's resume position and watched flag for a recording. */
  saveProgress: (progress: PlaybackProgress) =>
    Effect.flatMap(Api, (api) => api.playback.saveState({ payload: progress })),
  /** Revokes the device token this client sends. */
  logout: Effect.flatMap(Api, (api) => api.auth.logout()),
  /** Approves or blocks a TV sign-in, optionally as another household profile. */
  answerDeviceCode: (approval: DeviceCodeApproval) =>
    Effect.flatMap(Api, (api) => api.auth.approveDeviceCode({ payload: approval })),
};
