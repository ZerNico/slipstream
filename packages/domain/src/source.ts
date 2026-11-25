import { Schema } from "effect";
import { SourceId, SourceStreamId } from "./ids.ts";
import { Instant } from "./time.ts";

/** An absolute http(s) URL. */
export const HttpUrl = Schema.String.check(
  Schema.isPattern(/^https?:\/\/\S+$/, { title: "http(s) URL" }),
);

/**
 * How Slipstream reaches a source, as stored. Only `M3u` is MVP; the others are v1 and later.
 * Holds secrets (the Xtream password, credentials inside URLs): the API never returns it, only
 * `SourceConfigView`.
 */
export const SourceConfig = Schema.TaggedUnion({
  M3u: { playlistUrl: HttpUrl, guideUrl: Schema.optionalKey(HttpUrl) },
  Xtream: { serverUrl: HttpUrl, username: Schema.String, password: Schema.String },
  HdHomeRun: { deviceUrl: HttpUrl },
  Url: { streamUrl: HttpUrl },
}).annotate({ identifier: "SourceConfig" });
export type SourceConfig = typeof SourceConfig.Type;

/** A rewrite applied to guide titles or sub-titles of one source while importing. */
export const GuideRewrite = Schema.Struct({
  field: Schema.Literals(["title", "subtitle"]),
  pattern: Schema.String,
  replacement: Schema.String,
}).annotate({ identifier: "GuideRewrite" });
export type GuideRewrite = typeof GuideRewrite.Type;

/** Per-source guide clean-up (what `epgfix` does today, plus optional rewrites). */
export const GuideCleanup = Schema.Struct({
  removeDuplicates: Schema.Boolean,
  rewrites: Schema.Array(GuideRewrite),
}).annotate({ identifier: "GuideCleanup" });
export type GuideCleanup = typeof GuideCleanup.Type;

/** Health of a source, as the last refresh or capture saw it. */
export const SourceHealth = Schema.Literals(["unknown", "ok", "unreachable", "limitReached"]);
export type SourceHealth = typeof SourceHealth.Type;

/** An upstream provider of streams and guide data. */
export const Source = Schema.Struct({
  id: SourceId,
  name: Schema.NonEmptyString,
  config: SourceConfig,
  refreshIntervalMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(5)),
  /** Concurrent upstream connections the provider allows; absent means unlimited. */
  maxStreams: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  /**
   * Of `maxStreams`, how many live viewing may never take ("2 are kept for recordings", SPEC
   * 7.9). Absent means 0: recordings still win by stopping viewers.
   */
  keptForRecordings: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  userAgent: Schema.optionalKey(Schema.String),
  /** Plain request headers, shown back to admins. Credentials go in `secretHeaders`. */
  headers: Schema.Record(Schema.String, Schema.String),
  /** Write-only request headers (e.g. `Authorization`); views list only their names. */
  secretHeaders: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  guideCleanup: GuideCleanup,
  enabled: Schema.Boolean,
  health: SourceHealth,
  lastRefreshAt: Schema.optionalKey(Instant),
  /**
   * Add new streams on refresh when their group already has added streams. Absent means off.
   */
  autoAddNew: Schema.optionalKey(Schema.Boolean),
  /** When an admin last went through its streams; streams first seen later are new. */
  reviewedAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "Source" });
export type Source = typeof Source.Type;

/** One stream a source offers (an M3U entry, an Xtream live stream). */
export const SourceStream = Schema.Struct({
  id: SourceStreamId,
  sourceId: SourceId,
  upstreamId: Schema.String,
  name: Schema.String,
  url: HttpUrl,
  tvgId: Schema.optionalKey(Schema.String),
  logoUrl: Schema.optionalKey(HttpUrl),
  group: Schema.optionalKey(Schema.String),
  lastSeenAt: Instant,
}).annotate({ identifier: "SourceStream" });
export type SourceStream = typeof SourceStream.Type;
