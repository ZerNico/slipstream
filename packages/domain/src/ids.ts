import { Schema } from "effect";

/*
 * Branded identifiers. Every entity id is an opaque non-empty string on the wire (the server
 * generates UUIDs), branded so a ChannelId can never be passed where a RecordingId is expected.
 */

export const SourceId = Schema.NonEmptyString.pipe(Schema.brand("SourceId"));
export type SourceId = typeof SourceId.Type;

export const SourceStreamId = Schema.NonEmptyString.pipe(Schema.brand("SourceStreamId"));
export type SourceStreamId = typeof SourceStreamId.Type;

export const ChannelId = Schema.NonEmptyString.pipe(Schema.brand("ChannelId"));
export type ChannelId = typeof ChannelId.Type;

export const ChannelStreamId = Schema.NonEmptyString.pipe(Schema.brand("ChannelStreamId"));
export type ChannelStreamId = typeof ChannelStreamId.Type;

export const ProgrammeId = Schema.NonEmptyString.pipe(Schema.brand("ProgrammeId"));
export type ProgrammeId = typeof ProgrammeId.Type;

export const CaptureId = Schema.NonEmptyString.pipe(Schema.brand("CaptureId"));
export type CaptureId = typeof CaptureId.Type;

export const RecordingId = Schema.NonEmptyString.pipe(Schema.brand("RecordingId"));
export type RecordingId = typeof RecordingId.Type;

export const RuleId = Schema.NonEmptyString.pipe(Schema.brand("RuleId"));
export type RuleId = typeof RuleId.Type;

export const CollectionId = Schema.NonEmptyString.pipe(Schema.brand("CollectionId"));
export type CollectionId = typeof CollectionId.Type;

export const UserId = Schema.NonEmptyString.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const DeviceId = Schema.NonEmptyString.pipe(Schema.brand("DeviceId"));
export type DeviceId = typeof DeviceId.Type;

export const PlaybackSessionId = Schema.NonEmptyString.pipe(Schema.brand("PlaybackSessionId"));
export type PlaybackSessionId = typeof PlaybackSessionId.Type;

export const InviteId = Schema.NonEmptyString.pipe(Schema.brand("InviteId"));
export type InviteId = typeof InviteId.Type;
