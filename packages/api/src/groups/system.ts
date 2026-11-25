import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  CaptureId,
  CaptureState,
  ChannelId,
  HardwareCaps,
  Instant,
  RecordingId,
  RecordingState,
  SourceHealth,
  SourceId,
  UserId,
} from "@slipstream/domain";
import { Authentication } from "../security.ts";

/** One storage location and how it is used. */
export const StorageUsage = Schema.Struct({
  path: Schema.String,
  totalBytes: Schema.Int,
  freeBytes: Schema.Int,
  recordingsBytes: Schema.Int,
  /** Pause-and-rewind (DVR window) data. */
  bufferBytes: Schema.Int,
  /** Below this, DVR windows shrink first, then old unprotected recordings go. */
  freeSpaceFloorBytes: Schema.Int,
}).annotate({ identifier: "StorageUsage" });
export type StorageUsage = typeof StorageUsage.Type;

/** The system page: versions, the ffmpeg self-check, storage and source health. */
export const SystemInfo = Schema.Struct({
  version: Schema.String,
  /** The household's IANA time zone ("Europe/Berlin"): rule weekdays and group paths use it. */
  timeZone: Schema.String,
  ffmpeg: Schema.Struct({
    version: Schema.String,
    selfCheck: Schema.Literals(["ok", "failed", "pending"]),
    detail: Schema.optionalKey(Schema.String),
  }),
  /** Hardware encoders the startup test found; absent until detection has run. */
  hardware: Schema.optionalKey(HardwareCaps),
  storage: Schema.Array(StorageUsage),
  sources: Schema.Array(Schema.Struct({ sourceId: SourceId, health: SourceHealth })),
}).annotate({ identifier: "SystemInfo" });
export type SystemInfo = typeof SystemInfo.Type;

/**
 * Live state changes pushed over SSE so badges and progress update without a reload.
 * `Connected` is sent once, immediately after the stream opens (and after every reconnect), so
 * clients know it is live and can refetch what they may have missed while disconnected.
 */
export const ServerEvent = Schema.TaggedUnion({
  Connected: { at: Instant },
  RecordingChanged: { recordingId: RecordingId, state: RecordingState },
  /**
   * A recording was deleted (by someone, or by retention or the disk guard). `ownerIds` are its
   * owners at the moment it went, so the server can still tell who may hear about it once the
   * row is gone, and clients drop it from lists and close a player showing it.
   */
  RecordingRemoved: { recordingId: RecordingId, ownerIds: Schema.NonEmptyArray(UserId) },
  /**
   * A good repeat replaced a damaged recording (§3.7): `id` is the repeat, `replacedId` the
   * original, now hidden. Lists drop the original; the TV shows a toast when it is open.
   */
  RecordingReplaced: { id: RecordingId, replacedId: RecordingId },
  CaptureChanged: { captureId: CaptureId, channelId: ChannelId, state: CaptureState },
  SourceHealthChanged: { sourceId: SourceId, health: SourceHealth },
  GuideRefreshed: { sourceId: SourceId },
}).annotate({ identifier: "ServerEvent" });
export type ServerEvent = typeof ServerEvent.Type;

/** The public health probe's answer. */
export const HealthStatus = Schema.Struct({ status: Schema.Literal("ok") }).annotate({
  identifier: "HealthStatus",
});
export type HealthStatus = typeof HealthStatus.Type;

/** System: health probe (public), system info and the live event stream. */
export class SystemGroup extends HttpApiGroup.make("system")
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: HealthStatus,
    }),
    HttpApiEndpoint.get("info", "/system", { success: SystemInfo }).middleware(Authentication),
    HttpApiEndpoint.get("events", "/events", {
      success: HttpApiSchema.StreamSse({ data: ServerEvent, keepAlive: "30 seconds" }),
    }).middleware(Authentication),
  )
  .annotateMerge(OpenApi.annotations({ title: "System" })) {}
