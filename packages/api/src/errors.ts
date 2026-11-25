import { Schema } from "effect";
import { ChannelId, SourceId, TimeRange } from "@slipstream/domain";

/*
 * Typed API errors. Each carries its HTTP status and enough structure for a client to show a
 * plain-language message from i18n; none carries user-facing text of its own.
 */

/** The kinds of entity an id can point to, for `NotFound`. */
export const EntityKind = Schema.Literals([
  "source",
  "channel",
  "programme",
  "recording",
  "rule",
  "collection",
  "capture",
  "device",
  "user",
  "playbackSession",
  "invite",
  "frame",
  "notice",
]);
export type EntityKind = typeof EntityKind.Type;

/** No entity of this kind with this id (or the caller may not see it). */
export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { entity: EntityKind, id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** One problem with a request body, pointing at the field it concerns. */
export const InputProblem = Schema.Struct({
  /** Dotted path into the payload, e.g. `matcher.title.0.pattern`. */
  path: Schema.String,
  /** A stable code clients map to a message, e.g. `invalidRegex`, `matchesEverything`. */
  code: Schema.String,
});
export type InputProblem = typeof InputProblem.Type;

/** The request was well-formed but fails domain validation. */
export class InvalidInput extends Schema.TaggedError<InvalidInput>()(
  "InvalidInput",
  { problems: Schema.Array(InputProblem) },
  { httpApiStatus: 422 },
) {}

/**
 * Why a change conflicts with existing state, one name per case:
 *
 * - profiles and guests: `usernameTaken`, `lastAdmin` (demoting or deleting the last admin),
 *   `deleteSelf`;
 * - collections: `followsRule` (a matcher for a collection that follows a series recording; its
 *   conditions are the series recording's until it is unlinked);
 * - rules: `undoExpired` (an undo after `ruleUndoWindowMillis`), `alreadyGrouped` (grouping a
 *   series recording that already records into a collection);
 * - recordings: `programmeEnded`, `notRecording` (stopping or extending one that is not running),
 *   `alreadyScheduled`;
 * - "Keep the original": `notARepeat`, `notReplaced`, `keepOriginalExpired`.
 */
export const ConflictCode = Schema.Literals([
  "usernameTaken",
  "lastAdmin",
  "deleteSelf",
  "followsRule",
  "undoExpired",
  "alreadyGrouped",
  "programmeEnded",
  "notRecording",
  "alreadyScheduled",
  "notARepeat",
  "notReplaced",
  "keepOriginalExpired",
]);
export type ConflictCode = typeof ConflictCode.Type;

/** The change conflicts with existing state (a duplicate name, a recording already running). */
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { code: ConflictCode },
  { httpApiStatus: 409 },
) {}

/** No valid session or device token. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

/** Signed in, but the role or permissions do not allow this. */
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  {},
  { httpApiStatus: 403 },
) {}

/** Wrong username or password. Deliberately does not say which. */
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  "InvalidCredentials",
  {},
  { httpApiStatus: 401 },
) {}

/** Too many attempts; try again after the given number of seconds. */
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  { retryAfterSeconds: Schema.Int },
  { httpApiStatus: 429 },
) {}

/** First-run setup has not created the admin account yet. */
export class SetupRequired extends Schema.TaggedError<SetupRequired>()(
  "SetupRequired",
  {},
  { httpApiStatus: 409 },
) {}

/** Setup was already completed; there is no way to run it twice. */
export class AlreadySetUp extends Schema.TaggedError<AlreadySetUp>()(
  "AlreadySetUp",
  {},
  { httpApiStatus: 409 },
) {}

/**
 * Device-code login: the user has not confirmed yet (`pending`), the TV polls too fast
 * (`slowDown`), or the code is no longer valid (`expired`). Mirrors RFC 8628.
 */
export class DeviceCodeNotReady extends Schema.TaggedError<DeviceCodeNotReady>()(
  "DeviceCodeNotReady",
  { reason: Schema.Literals(["pending", "slowDown", "expired", "denied"]) },
  { httpApiStatus: 400 },
) {}

/**
 * A source could not be reached or did not return usable data. `tooLarge`: the playlist or
 * guide is larger than Slipstream accepts.
 */
export class SourceFailed extends Schema.TaggedError<SourceFailed>()(
  "SourceFailed",
  {
    reason: Schema.Literals([
      "unreachable",
      "httpError",
      "invalidPlaylist",
      "invalidGuide",
      "tooLarge",
    ]),
    httpStatus: Schema.optionalKey(Schema.Int),
  },
  { httpApiStatus: 502 },
) {}

/**
 * Switching to this profile needs its PIN, or the password for an admin profile without a PIN
 * (SPEC 7.8: the lock icon in the profile switcher). Send it again with `secret`. Clients show
 * `profile_locked_<requires>`.
 */
export class ProfileLocked extends Schema.TaggedError<ProfileLocked>()(
  "ProfileLocked",
  { requires: Schema.Literals(["pin", "password"]) },
  { httpApiStatus: 403 },
) {}

/** A guest invite link that can no longer be used. Clients show `invite_invalid_<reason>`. */
export class InviteInvalid extends Schema.TaggedError<InviteInvalid>()(
  "InviteInvalid",
  { reason: Schema.Literals(["expired", "used", "revoked"]) },
  { httpApiStatus: 410 },
) {}

/**
 * No stream is free for watching (SPEC 7.9): every watching stream of the source is in use
 * (`sourceFull`, with the source, so the player can ask the streams group who uses them and
 * offer "Stop arte on Kitchen Shield"), or the profile reached its own limit (`profileLimit`).
 * Clients show `streamLimitText(reason)` from `@slipstream/i18n` (a title and a hint).
 */
export class StreamLimitReached extends Schema.TaggedError<StreamLimitReached>()(
  "StreamLimitReached",
  {
    reason: Schema.Literals(["sourceFull", "profileLimit"]),
    sourceId: Schema.optionalKey(SourceId),
  },
  { httpApiStatus: 409 },
) {}

/** Why no stream was free for watching (`StreamLimitReached`). */
export type StreamLimitReason = StreamLimitReached["reason"];

/**
 * A range session asked for a stretch the timeshift buffer no longer holds (or never captured):
 * start over on a programme that ended too long ago, with no recording of it. Clients show
 * `playback_not_captured` ("no longer in pause & rewind").
 */
export class RangeNotCaptured extends Schema.TaggedError<RangeNotCaptured>()(
  "RangeNotCaptured",
  { channelId: ChannelId, range: TimeRange },
  { httpApiStatus: 404 },
) {}
