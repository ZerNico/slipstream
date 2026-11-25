import { Schema } from "effect";
import { DeviceId, ProgrammeId, RecordingId, UserId } from "./ids.ts";
import { Instant } from "./time.ts";

/** Admins manage sources, channels, users and settings; users watch and record. */
export const Role = Schema.Literals(["admin", "user"]);
export type Role = typeof Role.Type;

/** A local account. */
export const User = Schema.Struct({
  id: UserId,
  username: Schema.NonEmptyString,
  displayName: Schema.NonEmptyString,
  role: Role,
  createdAt: Instant,
}).annotate({ identifier: "User" });
export type User = typeof User.Type;

/** What kind of client a device is, for its icon and defaults. */
export const DeviceKind = Schema.Literals(["tv", "phone", "tablet", "web"]);
export type DeviceKind = typeof DeviceKind.Type;

/** A paired device with its own long-lived, revocable token. */
export const Device = Schema.Struct({
  id: DeviceId,
  userId: UserId,
  name: Schema.NonEmptyString,
  kind: DeviceKind,
  createdAt: Instant,
  lastSeenAt: Schema.optionalKey(Instant),
  revokedAt: Schema.optionalKey(Instant),
  /**
   * A shared household device ("Household · pick on the TV"): it switches between household
   * profiles without signing in again, and never acts with admin rights. `userId` is the profile
   * it acts as now. Absent means false.
   */
  household: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Device" });
export type Device = typeof Device.Type;

/** What a playback position belongs to. */
export const PlaybackTarget = Schema.TaggedUnion({
  Recording: { recordingId: RecordingId },
  Programme: { programmeId: ProgrammeId },
}).annotate({ identifier: "PlaybackTarget" });
export type PlaybackTarget = typeof PlaybackTarget.Type;

/** Resume position and watched state, per user. */
export const PlaybackState = Schema.Struct({
  userId: UserId,
  target: PlaybackTarget,
  positionMillis: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  watched: Schema.Boolean,
  updatedAt: Instant,
}).annotate({ identifier: "PlaybackState" });
export type PlaybackState = typeof PlaybackState.Type;
