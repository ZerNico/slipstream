/**
 * The SQLite schema (PLAN section 5). Times are epoch milliseconds in INTEGER columns; structured
 * values that are always read whole (matchers, layouts, padding) are JSON text typed with the
 * domain types. Values that are not plain JSON (instants inside recording problems) go through
 * their schema's JSON codec both ways (`schemaJson`). Column names are snake_case in SQL and
 * camelCase in code.
 *
 * Change this file, then run `pnpm --filter @slipstream/server db:generate` to add a migration.
 */
import {
  type AnySQLiteColumn,
  customType,
  index,
  integer,
  primaryKey,
  sqliteTableCreator,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { Schema } from "effect";
import {
  type AccessPolicy,
  type AccountKind,
  type AvatarTone,
  type CaptureError,
  type CaptureStats,
  type CollectionLayout,
  type DeviceKind,
  type EpisodeClass,
  type EpisodeInfo,
  type GuideCleanup,
  type HiddenReason,
  type Matcher,
  type PartialDate,
  RecordingProblem,
  type RecordingState,
  type RerunOutcome,
  type Retention,
  type Role,
  type SourceHealth,
} from "@slipstream/domain";
import type { StoredStreamInfo } from "./codec.ts";

const table = sqliteTableCreator((name) => name, "snake_case");

const millis = () => integer({ mode: "number" });
const flag = () => integer({ mode: "boolean" });
const json = <T>() => text({ mode: "json" }).$type<T>();

/**
 * JSON text written and read through a schema's JSON codec, for values JSON alone does not
 * round-trip (an `Instant` would come back as a string and fail to encode in API answers).
 */
const schemaJson = <T, E>(codec: Schema.Codec<T, E>) => {
  const encode = Schema.encodeSync(codec);
  const decode = Schema.decodeUnknownSync(codec);
  return customType<{ data: T; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => JSON.stringify(encode(value)),
    fromDriver: (value) => decode(JSON.parse(value)),
  });
};

const problemsJson = schemaJson(Schema.toCodecJson(Schema.Array(RecordingProblem)));

/** Key/value settings the server owns (signing secret, household time zone). */
export const settings = table("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export const users = table(
  "users",
  {
    id: text().primaryKey(),
    username: text().notNull(),
    displayName: text().notNull(),
    role: text().$type<Role>().notNull(),
    /**
     * `scrypt$N$r$p$salt$hash`, see auth/crypto.ts. Household profiles added without a password
     * hold a value that never verifies.
     */
    passwordHash: text().notNull(),
    createdAt: millis().notNull(),
    /** Household profile or guest (SPEC 7.8). */
    kind: text().$type<AccountKind>().notNull().default("household"),
    avatarTone: text().$type<AvatarTone>().notNull().default("amber"),
    /** scrypt hash of the profile PIN; `null` when the profile has none. */
    pinHash: text(),
    /** What the profile may see and do; `null` is full access. */
    access: json<AccessPolicy>(),
    lastSeenAt: millis(),
    /** Whether the last request came from the household's network or from outside. */
    lastSeenFrom: text().$type<"home" | "away">(),
  },
  (t) => [uniqueIndex("users_username_unique").on(t.username)],
);

export const devices = table(
  "devices",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: text().$type<DeviceKind>().notNull(),
    createdAt: millis().notNull(),
    lastSeenAt: millis(),
    revokedAt: millis(),
    /** A shared household device: switches between household profiles, never acts as admin. */
    household: flag().notNull().default(false),
  },
  (t) => [index("devices_user_idx").on(t.userId)],
);

/**
 * Browser sessions and device tokens. Only the SHA-256 of the bearer secret is stored, so a
 * leaked database does not leak working credentials.
 */
export const sessions = table(
  "sessions",
  {
    id: text().primaryKey(),
    tokenHash: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text().references(() => devices.id, { onDelete: "cascade" }),
    createdAt: millis().notNull(),
    expiresAt: millis().notNull(),
    lastSeenAt: millis().notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/**
 * Guest invites (SPEC 7.8). The token is looked up by its SHA-256; a sealed copy (see
 * sources/secret-box.ts) lets admins copy the link again until it is used.
 */
export const invites = table(
  "invites",
  {
    id: text().primaryKey(),
    tokenHash: text().notNull(),
    sealedToken: text().notNull(),
    name: text().notNull(),
    access: json<AccessPolicy>().notNull(),
    createdBy: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: millis().notNull(),
    expiresAt: millis(),
    usedAt: millis(),
    revokedAt: millis(),
    /** The guest account that accepted it. */
    acceptedBy: text().references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("invites_token_hash_unique").on(t.tokenHash)],
);

/** Pending TV sign-ins (device-code flow). Rows go away once redeemed or expired. */
export const deviceCodes = table(
  "device_codes",
  {
    deviceCodeHash: text().primaryKey(),
    userCode: text().notNull(),
    deviceName: text().notNull(),
    deviceKind: text().$type<DeviceKind>().notNull(),
    status: text().$type<"pending" | "approved" | "denied">().notNull(),
    /** Who approved it; the device signs in as this user. */
    userId: text().references(() => users.id, { onDelete: "cascade" }),
    /** Approved as a shared household device. */
    household: flag().notNull().default(false),
    createdAt: millis().notNull(),
    expiresAt: millis().notNull(),
    lastPolledAt: millis(),
  },
  (t) => [uniqueIndex("device_codes_user_code_unique").on(t.userCode)],
);

export const sources = table("sources", {
  id: text().primaryKey(),
  name: text().notNull(),
  /**
   * The `SourceConfig` as JSON, sealed with the key in the config directory (see
   * sources/secret-box.ts). Holds credentials (URLs with tokens, passwords); never returned.
   */
  config: text().notNull(),
  refreshIntervalMinutes: integer().notNull(),
  maxStreams: integer(),
  /** Of `maxStreams`, how many live viewing may never take; `null` means 0. */
  keptForRecordings: integer(),
  userAgent: text(),
  headers: json<Record<string, string>>().notNull(),
  /** Write-only request headers as JSON, sealed like `config`; `null` when there are none. */
  secretHeaders: text(),
  guideCleanup: json<GuideCleanup>().notNull(),
  enabled: flag().notNull(),
  health: text().$type<SourceHealth>().notNull(),
  lastRefreshAt: millis(),
  /**
   * When an admin last went through the source's streams. Streams first seen after it that are
   * neither added nor ignored count as new; `null` (never) makes every such stream new.
   */
  reviewedAt: millis(),
  /** Add new streams of groups that already have added streams on refresh. */
  autoAddNew: flag().notNull().default(false),
});

export const sourceStreams = table(
  "source_streams",
  {
    id: text().primaryKey(),
    sourceId: text()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    upstreamId: text().notNull(),
    name: text().notNull(),
    url: text().notNull(),
    tvgId: text(),
    logoUrl: text(),
    group: text(),
    channelNumber: text(),
    /** The playlist's own user agent for this stream (`#EXTVLCOPT:http-user-agent`). */
    userAgent: text(),
    /** The playlist's referrer for this stream (`#EXTVLCOPT:http-referrer`). */
    referrer: text(),
    lastSeenAt: millis().notNull(),
    /** The refresh that first listed it; with `sources.reviewed_at` it tells new streams. */
    firstSeenAt: millis().notNull().default(0),
    /** Set aside by an admin: never offered as new, never added automatically. */
    ignoredAt: millis(),
  },
  (t) => [
    uniqueIndex("source_streams_upstream_unique").on(t.sourceId, t.upstreamId),
    index("source_streams_tvg_idx").on(t.tvgId),
  ],
);

/** XMLTV `<channel>` entries per source, for mapping and the "unmapped streams" count. */
export const guideChannels = table(
  "guide_channels",
  {
    sourceId: text()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    xmltvId: text().notNull(),
    displayName: text().notNull(),
    iconUrl: text(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.xmltvId] })],
);

export const channels = table(
  "channels",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    number: integer(),
    logoUrl: text(),
    guideChannelId: text(),
    favourite: flag().notNull(),
    hidden: flag().notNull(),
    /**
     * Removed by an admin (or merged into another channel): out of every list, the guide,
     * playback and planning, but kept so its recordings, captures and history keep their
     * channel. Never deleted: recordings and captures cascade on the row.
     */
    removedAt: millis(),
    /** The channel it was merged into, when a merge removed it. */
    mergedInto: text(),
  },
  (t) => [index("channels_guide_idx").on(t.guideChannelId)],
);

export const channelStreams = table(
  "channel_streams",
  {
    id: text().primaryKey(),
    channelId: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    sourceStreamId: text()
      .notNull()
      .references(() => sourceStreams.id, { onDelete: "cascade" }),
    priority: integer().notNull(),
  },
  (t) => [
    uniqueIndex("channel_streams_unique").on(t.channelId, t.sourceStreamId),
    index("channel_streams_stream_idx").on(t.sourceStreamId),
  ],
);

/**
 * Pairs of channels an admin said are not the same ("Not the same" on a merge suggestion, or a
 * split): never suggested for merging again. Stored once per pair, `channelA < channelB`.
 */
export const channelsApart = table(
  "channels_apart",
  {
    channelA: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    channelB: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    createdAt: millis().notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelA, t.channelB] })],
);

/**
 * The cleaned guide, keyed by XMLTV channel id. Channels pick it up through
 * `channels.guide_channel_id`, so remapping a channel needs no re-import. `programmes_fts`
 * (FTS5, created in a custom migration) indexes title, sub-title and description.
 */
export const programmes = table(
  "programmes",
  {
    rowid: integer().primaryKey({ autoIncrement: true }),
    id: text().notNull(),
    sourceId: text()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    guideChannelId: text().notNull(),
    start: millis().notNull(),
    end: millis().notNull(),
    title: text().notNull(),
    subtitle: text(),
    description: text(),
    categories: json<ReadonlyArray<string>>().notNull(),
    episode: json<EpisodeInfo>(),
    originalAirDate: json<PartialDate>(),
    repeat: flag().notNull(),
    live: flag().notNull(),
    imageUrl: text(),
    /** A picture found online for the title (TMDB), filled in by the online artwork worker. */
    onlineImageUrl: text(),
  },
  (t) => [
    uniqueIndex("programmes_id_unique").on(t.id),
    index("programmes_channel_time_idx").on(t.guideChannelId, t.start),
    index("programmes_source_idx").on(t.sourceId),
    index("programmes_end_idx").on(t.end),
  ],
);

/**
 * What an online lookup found for a title (TMDB), one row per title key (`movie:…` or `tv:…`):
 * the picture, or nothing (`imageUrl` null) so the title is not asked for again until
 * `lookedUpAt` is old enough.
 */
export const onlineArtwork = table("online_artwork", {
  titleKey: text().primaryKey(),
  imageUrl: text(),
  lookedUpAt: millis().notNull(),
});

/**
 * Household-wide collections. A collection that follows a series recording (recording model
 * §3.4) has `rule_id`; its `matcher` is then the snapshot of that rule's *what* conditions,
 * rewritten with every save of the rule, used when the rule is missing and copied on unlinking.
 * Deleting the rule is refused while a collection follows it: the services unlink or remove the
 * collection first, so a link never silently turns into an unknown matcher.
 */
export const collections = table(
  "collections",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    rank: integer().notNull(),
    matcher: json<Matcher>().notNull(),
    labels: json<ReadonlyArray<string>>().notNull(),
    layout: json<CollectionLayout>().notNull(),
    retention: json<Retention>(),
    ruleId: text().references((): AnySQLiteColumn => rules.id, { onDelete: "restrict" }),
  },
  (t) => [uniqueIndex("collections_rule_unique").on(t.ruleId)],
);

export const rules = table(
  "rules",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    enabled: flag().notNull(),
    ownerId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matcher: json<Matcher>().notNull(),
    paddingBeforeMinutes: integer().notNull(),
    paddingAfterMinutes: integer().notNull(),
    retention: json<Retention>().notNull(),
    collectionId: text().references(() => collections.id, { onDelete: "set null" }),
    exportTemplate: text(),
    createdAt: millis().notNull(),
    /** "Only episodes you don't have yet" (recording model §3.6). */
    skipRepeats: flag().notNull().default(true),
    /** The owner said "No thanks" to the collection offer (§3.3). */
    offerDeclined: flag().notNull().default(false),
  },
  (t) => [index("rules_owner_idx").on(t.ownerId)],
);

/** A retained range on a channel, with a snapshot of the guide entry it was scheduled from. */
export const recordings = table(
  "recordings",
  {
    id: text().primaryKey(),
    programmeId: text(),
    channelId: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    start: millis().notNull(),
    end: millis().notNull(),
    title: text().notNull(),
    subtitle: text(),
    description: text(),
    categories: json<ReadonlyArray<string>>().notNull(),
    episode: json<EpisodeInfo>(),
    originalAirDate: json<PartialDate>(),
    repeat: flag().notNull(),
    live: flag().notNull(),
    imageUrl: text(),
    /** A picture found online for the title (TMDB), filled in by the online artwork worker. */
    onlineImageUrl: text(),
    paddingBeforeMinutes: integer().notNull(),
    paddingAfterMinutes: integer().notNull(),
    /** `user` once someone set the padding (re-planning keeps it); else it follows the rule. */
    paddingSource: text().$type<"rule" | "user">(),
    state: text().$type<RecordingState>().notNull(),
    problems: problemsJson().notNull(),
    ruleId: text().references(() => rules.id, { onDelete: "set null" }),
    protected: flag().notNull(),
    pinnedCollectionId: text().references(() => collections.id, { onDelete: "set null" }),
    exportStatus: text().$type<"none" | "pending" | "done" | "failed">().notNull(),
    /** Set when someone stopped it early; the retained range ends here instead of at end + padding. */
    stoppedAt: millis(),
    createdAt: millis().notNull(),
    /** The moment the grabbed artwork frame shows; `null` until one was grabbed. */
    frameAt: millis(),
    /** Failed frame grabs; the grabber gives up after a few. */
    frameFailures: integer().notNull().default(0),
    /** On a repeat: the chain's original, the first damaged recording of the episode (§3.7). */
    replacesId: text().references((): AnySQLiteColumn => recordings.id, { onDelete: "set null" }),
    /** On an original: the good repeat that replaced it. */
    replacedById: text().references((): AnySQLiteColumn => recordings.id, {
      onDelete: "set null",
    }),
    /** Replaced, or deleted while its chain still looks for a repeat: out of every list. */
    hiddenAt: millis(),
    /** Why it is hidden: `replaced` by its repeat, or `deleted` (an anchor). Set with `hiddenAt`. */
    hiddenReason: text().$type<HiddenReason>(),
    /** The stored end of a chain's search: `kept`, `declined` or `exhausted`. */
    rerunOutcome: text().$type<RerunOutcome>(),
    /** Until when the chain looks for a repeat: the programme end + 14 days. */
    rerunUntil: millis(),
    /** Repeats in this chain that ended needing a repeat themselves. */
    rerunAttempts: integer().notNull().default(0),
  },
  (t) => [
    index("recordings_channel_time_idx").on(t.channelId, t.start),
    index("recordings_state_idx").on(t.state),
    index("recordings_programme_idx").on(t.programmeId),
  ],
);

/** Two people recording the same programme share one recording with two owners. */
export const recordingOwners = table(
  "recording_owners",
  {
    recordingId: text()
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: millis().notNull(),
    /**
     * The series recording that added this owner because it left its own airing out as a repeat
     * of this recording (§5.3), so Undo after "Record series" takes back exactly these.
     */
    addedByRuleId: text().references(() => rules.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.recordingId, t.userId] }),
    index("recording_owners_user_idx").on(t.userId),
  ],
);

/**
 * People who left a shared recording. Re-planning their rules never makes them owners of it
 * again; recording it themselves does (and ends the decline). Never also an owner row.
 */
export const recordingDeclines = table(
  "recording_declines",
  {
    recordingId: text()
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    declinedAt: millis().notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.userId] })],
);

/**
 * Episodes people had and deleted (recording model §3.6), so a series recording set to "Only
 * episodes you don't have yet" does not record them again. Per owner; the identity columns are
 * those of the domain's `EpisodeHistoryEntry`.
 */
export const episodeHistory = table(
  "episode_history",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: text().references(() => rules.id, { onDelete: "set null" }),
    showKey: text().notNull(),
    season: integer(),
    episode: integer(),
    subtitleKey: text(),
    filmYear: integer(),
    class: text().$type<EpisodeClass>().notNull(),
    airedAt: millis().notNull(),
    channelId: text().notNull(),
    title: text().notNull(),
    createdAt: millis().notNull(),
  },
  (t) => [
    index("episode_history_user_show_idx").on(t.userId, t.showKey),
    index("episode_history_rule_idx").on(t.ruleId),
  ],
);

/** Manual labels on recordings; collections can match on them. */
export const recordingLabels = table(
  "recording_labels",
  {
    recordingId: text()
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    label: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recordingId, t.label] }),
    index("recording_labels_label_idx").on(t.label),
  ],
);

export const captures = table(
  "captures",
  {
    id: text().primaryKey(),
    channelId: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    sourceStreamId: text().notNull(),
    startedAt: millis().notNull(),
    endedAt: millis(),
    state: text().$type<"starting" | "running" | "reconnecting" | "stopped" | "failed">().notNull(),
    error: json<CaptureError>(),
    stats: json<CaptureStats>().notNull(),
    streamInfo: json<StoredStreamInfo>(),
    /** Segment store directory of this capture; segment paths are relative to it. */
    directory: text().notNull(),
    /**
     * The live playlist's media sequence number of this capture's segment 0. Set the first time
     * the capture shows in a live playlist and never changed, so the channel's numbering only
     * grows across captures (`hls/live.ts`).
     */
    sequenceBase: integer(),
    /** Discontinuities on the channel before this capture's first segment, set with `sequenceBase`. */
    discontinuityBase: integer(),
  },
  (t) => [index("captures_channel_idx").on(t.channelId, t.startedAt)],
);

/** The segment store index: one row per ~6 s MPEG-TS file. */
export const segments = table(
  "segments",
  {
    captureId: text()
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    sequence: integer().notNull(),
    runId: text().notNull(),
    startMs: millis().notNull(),
    durationMs: integer().notNull(),
    bytes: integer().notNull(),
    path: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.captureId, t.sequence] }),
    index("segments_capture_start_idx").on(t.captureId, t.startMs),
  ],
);

/** ffmpeg log lines worth keeping per capture (warnings and errors). */
export const captureLogs = table(
  "capture_logs",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    captureId: text()
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    at: millis().notNull(),
    level: text().$type<"debug" | "info" | "warning" | "error">().notNull(),
    message: text().notNull(),
  },
  (t) => [index("capture_logs_capture_idx").on(t.captureId, t.at)],
);

/** Resume position and watched state per user and recording or programme. */
export const playbackStates = table(
  "playback_states",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetKind: text().$type<"Recording" | "Programme">().notNull(),
    targetId: text().notNull(),
    positionMillis: integer().notNull(),
    watched: flag().notNull(),
    updatedAt: millis().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.targetKind, t.targetId] }),
    index("playback_states_updated_idx").on(t.userId, t.updatedAt),
  ],
);
