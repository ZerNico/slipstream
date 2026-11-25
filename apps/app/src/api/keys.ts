/**
 * TanStack Query keys. The cache is cleared whenever the server or profile changes, so keys
 * never need to name the connection. Prefix keys (`recordingsAll`) invalidate every variant.
 */

/** A query key: a tuple of JSON-friendly parts. */
export type QueryKey = readonly (string | number | boolean | undefined)[];

/**
 * Every query key the app uses, one per endpoint; the query options for each are in
 * `./queries.ts`. Nothing else builds a key.
 */
export const queryKeys = {
  /** The visible channels; every other channel list sits under it. */
  channels: ["channels"],
  /** Every channel, hidden ones too (Settings › Channels); under `channels`. */
  allChannels: ["channels", "all"],
  guideAll: ["guide"],
  /** One stretch of guide entries; the guides ask for one household day at a time. */
  guide: (from: number, to: number): QueryKey => ["guide", from, to],
  /** One channel's guide entries around now, for the player's Record; under `guideAll`. */
  channelGuide: (channelId: string, from: number, to: number): QueryKey => [
    "guide",
    "channel",
    channelId,
    from,
    to,
  ],
  /** Where the guide data ends, for a timeline as wide as its data before the days load. */
  guideExtent: ["guide", "extent"],
  /** One programme in full (description, pictures); under `guideAll`, so a new guide refreshes it. */
  programme: (id: string): QueryKey => ["guide", "programme", id],
  /** Every window of airings the viewer already has; under `guideAll`, so a new guide refreshes it. */
  guideRepeatsAll: ["guide", "repeats"],
  guideRepeats: (from: number, to: number): QueryKey => ["guide", "repeats", from, to],
  /** The guide's full-text search; under `guideAll`, so a new guide refreshes it. */
  guideSearch: (q: string): QueryKey => ["guide", "search", q],
  recordingsAll: ["recordings"],
  /** The library list; a removed recording leaves it at once (`applyCacheUpdate`). */
  recordings: ["recordings", "list"],
  recording: (id: string): QueryKey => ["recordings", "one", id],
  conflictsAll: ["conflicts"],
  conflicts: (from: number, to: number): QueryKey => ["conflicts", from, to],
  continueWatching: ["continueWatching"],
  recordOptionsAll: ["recordOptions"],
  recordOptions: (programmeId: string): QueryKey => ["recordOptions", programmeId],
  collections: ["collections"],
  /** The series recordings; the editor's previews sit under it. */
  rules: ["rules"],
  /** What a draft series recording would record (`rule` as JSON). */
  rulePreview: (rule: string, until: number): QueryKey => ["rules", "preview", rule, until],
  /** The household's profiles; the caller's own profile sits under it. */
  profiles: ["profiles"],
  /** The caller's own profile with its access policy (`GET /profiles/me`). */
  myProfile: ["profiles", "me"],
  guests: ["guests"],
  invites: ["guests", "invites"],
  me: ["me"],
  system: ["system"],
  /** The sources (their stream limits too); what each offers and uses sits under it. */
  sources: ["sources"],
  sourceStreams: (id: string): QueryKey => ["sources", "streams", id],
  /** Each source's streams in use against its limit. */
  streamsUsage: ["sources", "usage"],
  recordingSettings: ["settings", "recording"],
  artworkSettings: ["settings", "artwork"],
  liveSettings: ["settings", "live"],
  playbackSettings: ["settings", "playback"],
  pendingSignIn: (userCode: string): QueryKey => ["pendingSignIn", userCode],
} as const;
