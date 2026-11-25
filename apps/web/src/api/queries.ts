import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "effect";
import type { RuleInput } from "@slipstream/api";
import type {
  ChannelId,
  CollectionId,
  ProgrammeId,
  RecordingId,
  RuleId,
  SourceId,
} from "@slipstream/domain";
import type { Api } from "./client.ts";

/**
 * Query keys, one tree per server resource, so an SSE event or a mutation can invalidate a
 * whole branch ("recordings") or one leaf (`["recordings", "detail", id]`).
 */
export const keys = {
  setup: ["auth", "setup"] as const,
  me: ["auth", "me"] as const,
  system: ["system"] as const,
  channels: ["channels"] as const,
  /** What the lineup asks an admin to look at; under channels, and refetched with sources. */
  lineupReview: ["channels", "review"] as const,
  guide: ["guide"] as const,
  guideWindow: (from: number, to: number, channels: readonly ChannelId[] = []) =>
    ["guide", "window", from, to, channels.join(",")] as const,
  guideExtent: ["guide", "extent"] as const,
  nowNext: ["guide", "now-next"] as const,
  /**
   * Airings the viewer already has. Under guide, and refetched with rules, recordings and
   * collections through `guideRepeatsAll`.
   */
  guideRepeatsAll: ["guide", "repeats"] as const,
  guideRepeats: (from: number, to: number) => ["guide", "repeats", from, to] as const,
  guideSearch: (q: string) => ["guide", "search", q] as const,
  recordings: ["recordings"] as const,
  recordingList: ["recordings", "list"] as const,
  recording: (id: RecordingId) => ["recordings", "detail", id] as const,
  conflicts: (from: number, to: number) => ["recordings", "conflicts", from, to] as const,
  rules: ["rules"] as const,
  ruleList: ["rules", "list"] as const,
  rule: (id: RuleId) => ["rules", "detail", id] as const,
  rulePreview: (rule: unknown) => ["rules", "preview", rule] as const,
  /** The collection offer of one series recording; under rules, so rule writes refetch it. */
  ruleOffer: (id: RuleId) => ["rules", "offer", id] as const,
  /** How many deleted episodes a series recording keeps out for the caller. */
  ruleHistory: (id: RuleId) => ["rules", "history", id] as const,
  retention: ["recordings", "retention"] as const,
  collections: ["collections"] as const,
  similarPreview: (collectionId: CollectionId, recordingId: RecordingId) =>
    ["collections", "similar", collectionId, recordingId] as const,
  sources: ["sources"] as const,
  sourceStreams: (id: SourceId) => ["sources", "streams", id] as const,
  captures: ["captures"] as const,
  devices: ["devices"] as const,
  /**
   * Household profiles, guests and invites: every profile write invalidates this one branch, so
   * the avatar menu, settings, the library's owners and the TV approval all catch up together.
   */
  household: ["household"] as const,
  profiles: ["household", "profiles"] as const,
  myProfile: ["household", "me"] as const,
  guests: ["household", "guests"] as const,
  invites: ["household", "invites"] as const,
  invitePreview: (token: string) => ["auth", "invite", token] as const,
  settings: ["settings"] as const,
  recordingSettings: ["settings", "recording"] as const,
  artworkSettings: ["settings", "artwork"] as const,
  playbackSettings: ["settings", "playback"] as const,
  /** Under captures, so `CaptureChanged` refetches who uses which stream. */
  streams: ["captures", "streams"] as const,
  programmes: ["programmes"] as const,
  recordOptions: (id: ProgrammeId) => ["programmes", "record-options", id] as const,
  playback: ["playback"] as const,
  continueWatching: ["playback", "continue"] as const,
  playbackState: (id: RecordingId) => ["playback", "state", id] as const,
  /** One player's session for a source (`live:…`, `recording:…`, `range:…`) and attempt. */
  playbackSession: (source: string, attempt: number) =>
    ["playback", "session", source, attempt] as const,
  pendingSignIn: (code: string) => ["auth", "device-code", code] as const,
};

const at = (epochMs: number) => DateTime.makeUnsafe(epochMs);

/**
 * Every read the web makes, as TanStack Query options over the typed client. Screens and
 * route loaders share these, so a loader's `ensureQueryData` warms exactly what the screen
 * reads. Times in keys are epoch ms, so keys stay plain data.
 */
export const createQueries = (api: Api) => ({
  setupStatus: () =>
    queryOptions({
      queryKey: keys.setup,
      queryFn: () => api.call((client) => client.auth.setupStatus()),
      staleTime: Infinity,
    }),
  me: () =>
    queryOptions({
      queryKey: keys.me,
      queryFn: () => api.call((client) => client.auth.me()),
      staleTime: 5 * 60_000,
    }),
  system: () =>
    queryOptions({
      queryKey: keys.system,
      queryFn: () => api.call((client) => client.system.info()),
    }),
  lineupReview: () =>
    queryOptions({
      queryKey: keys.lineupReview,
      queryFn: () => api.call((client) => client.channels.review()),
      staleTime: 30_000,
    }),
  channels: () =>
    queryOptions({
      queryKey: keys.channels,
      queryFn: () => api.call((client) => client.channels.list({ query: { includeHidden: true } })),
    }),
  guideWindow: (from: number, to: number, channels?: readonly ChannelId[]) =>
    queryOptions({
      queryKey: keys.guideWindow(from, to, channels),
      queryFn: () =>
        api.call((client) =>
          client.guide.window({
            query: {
              from: at(from),
              to: at(to),
              ...(channels && channels.length > 0 ? { channels: channels.join(",") } : {}),
            },
          }),
        ),
    }),
  /** Where the guide data ends, so the timeline has its width before the days load. */
  guideExtent: () =>
    queryOptions({
      queryKey: keys.guideExtent,
      queryFn: () => api.call((client) => client.guide.extent()),
    }),
  /** Programmes from now on whose title (or more) matches `q`, as the server matches them. */
  guideSearch: (q: string) =>
    queryOptions({
      queryKey: keys.guideSearch(q),
      queryFn: () => api.call((client) => client.guide.search({ query: { q } })),
      staleTime: 60_000,
    }),
  /** Airings in the window the viewer already has, for the guide's repeat mark. */
  guideRepeats: (from: number, to: number) =>
    queryOptions({
      queryKey: keys.guideRepeats(from, to),
      queryFn: () =>
        api.call((client) => client.guide.repeats({ query: { from: at(from), to: at(to) } })),
    }),
  nowNext: () =>
    queryOptions({
      queryKey: keys.nowNext,
      queryFn: () => api.call((client) => client.guide.nowNext()),
      // What is on changes on the hour and half hour; a minute is plenty.
      refetchInterval: 60_000,
    }),
  recordings: () =>
    queryOptions({
      queryKey: keys.recordingList,
      queryFn: () => api.call((client) => client.recordings.list({ query: {} })),
    }),
  recording: (id: RecordingId) =>
    queryOptions({
      queryKey: keys.recording(id),
      queryFn: () => api.call((client) => client.recordings.get({ params: { recordingId: id } })),
    }),
  conflicts: (from: number, to: number) =>
    queryOptions({
      queryKey: keys.conflicts(from, to),
      queryFn: () =>
        api.call((client) =>
          client.recordings.conflicts({ query: { from: at(from), to: at(to) } }),
        ),
    }),
  rules: () =>
    queryOptions({
      queryKey: keys.ruleList,
      queryFn: () => api.call((client) => client.rules.list()),
    }),
  rule: (id: RuleId) =>
    queryOptions({
      queryKey: keys.rule(id),
      queryFn: () => api.call((client) => client.rules.get({ params: { ruleId: id } })),
    }),
  /** "Group these as “Live F1”?" for one series recording, when it applies. */
  ruleOffer: (id: RuleId) =>
    queryOptions({
      queryKey: keys.ruleOffer(id),
      queryFn: () => api.call((client) => client.rules.offer({ params: { ruleId: id } })),
    }),
  /** The caller's deleted episodes a series recording keeps out ("12 deleted episodes…"). */
  ruleHistory: (id: RuleId) =>
    queryOptions({
      queryKey: keys.ruleHistory(id),
      queryFn: () => api.call((client) => client.rules.history({ params: { ruleId: id } })),
    }),
  rulePreview: (rule: RuleInput, until: number) =>
    queryOptions({
      queryKey: keys.rulePreview({ rule, until }),
      queryFn: () =>
        api.call((client) => client.rules.preview({ payload: { rule, until: at(until) } })),
      // Typing changes the key on every keystroke; keep showing the last answer meanwhile.
      placeholderData: (previous) => previous,
      staleTime: 30_000,
    }),
  collections: () =>
    queryOptions({
      queryKey: keys.collections,
      queryFn: () => api.call((client) => client.collections.list()),
    }),
  sources: () =>
    queryOptions({
      queryKey: keys.sources,
      queryFn: () => api.call((client) => client.sources.list()),
    }),
  sourceStreams: (id: SourceId) =>
    queryOptions({
      queryKey: keys.sourceStreams(id),
      queryFn: () =>
        api.call((client) => client.sources.streams({ params: { sourceId: id }, query: {} })),
    }),
  captures: () =>
    queryOptions({
      queryKey: keys.captures,
      queryFn: () => api.call((client) => client.captures.list({ query: { active: true } })),
    }),
  devices: () =>
    queryOptions({
      queryKey: keys.devices,
      queryFn: () => api.call((client) => client.devices.list()),
    }),
  retention: () =>
    queryOptions({
      queryKey: keys.retention,
      queryFn: () => api.call((client) => client.recordings.retention()),
    }),
  similarPreview: (collectionId: CollectionId, recordingId: RecordingId) =>
    queryOptions({
      queryKey: keys.similarPreview(collectionId, recordingId),
      queryFn: () =>
        api.call((client) =>
          client.collections.previewSimilar({ params: { collectionId }, payload: { recordingId } }),
        ),
    }),
  playbackSettings: () =>
    queryOptions({
      queryKey: keys.playbackSettings,
      queryFn: () => api.call((client) => client.settings.playback()),
    }),
  profiles: () =>
    queryOptions({
      queryKey: keys.profiles,
      queryFn: () => api.call((client) => client.profiles.list()),
      staleTime: 5 * 60_000,
    }),
  myProfile: () =>
    queryOptions({
      queryKey: keys.myProfile,
      queryFn: () => api.call((client) => client.profiles.me()),
      staleTime: 5 * 60_000,
    }),
  guests: () =>
    queryOptions({
      queryKey: keys.guests,
      queryFn: () => api.call((client) => client.guests.list()),
    }),
  invites: () =>
    queryOptions({
      queryKey: keys.invites,
      queryFn: () => api.call((client) => client.guests.invites()),
    }),
  invitePreview: (token: string) =>
    queryOptions({
      queryKey: keys.invitePreview(token),
      queryFn: () => api.call((client) => client.invites.lookup({ payload: { token } })),
      staleTime: Infinity,
    }),
  artworkSettings: () =>
    queryOptions({
      queryKey: keys.artworkSettings,
      queryFn: () => api.call((client) => client.settings.artwork()),
      staleTime: 5 * 60_000,
    }),
  recordingSettings: () =>
    queryOptions({
      queryKey: keys.recordingSettings,
      queryFn: () => api.call((client) => client.settings.recording()),
      staleTime: 5 * 60_000,
    }),
  streams: () =>
    queryOptions({
      queryKey: keys.streams,
      queryFn: () => api.call((client) => client.streams.list()),
      staleTime: 5_000,
    }),
  recordOptions: (id: ProgrammeId) =>
    queryOptions({
      queryKey: keys.recordOptions(id),
      queryFn: () =>
        api.call((client) => client.programmes.recordOptions({ params: { programmeId: id } })),
    }),
  continueWatching: () =>
    queryOptions({
      queryKey: keys.continueWatching,
      queryFn: () => api.call((client) => client.playback.continueWatching()),
    }),
  playbackState: (id: RecordingId) =>
    queryOptions({
      queryKey: keys.playbackState(id),
      queryFn: () => api.call((client) => client.playback.state({ params: { recordingId: id } })),
    }),
  pendingSignIn: (code: string) =>
    queryOptions({
      queryKey: keys.pendingSignIn(code),
      queryFn: () =>
        api.call((client) => client.auth.pendingDeviceCode({ params: { userCode: code } })),
    }),
});

/** The read options for one {@link Api}. */
export type Queries = ReturnType<typeof createQueries>;
