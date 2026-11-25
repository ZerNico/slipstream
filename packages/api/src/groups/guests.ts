import { Schema, Struct } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  AccessPolicy,
  GuestInvite,
  Instant,
  InviteExpiry,
  InviteId,
  Profile,
  UserId,
} from "@slipstream/domain";
import {
  Conflict,
  Forbidden,
  InvalidInput,
  InviteInvalid,
  NotFound,
  RateLimited,
} from "../errors.ts";
import { Authentication } from "../security.ts";
import { DeviceInfo, LoginResult } from "./auth.ts";
import { Name, Password } from "../primitives.ts";

/**
 * A guest as admins see them: the profile (kind `guest`, never an admin) plus when and from
 * where they were last seen ("last seen Sat 14 Nov from outside your network").
 */
export const Guest = Profile.mapFields(
  Struct.assign({
    lastSeenAt: Schema.optionalKey(Instant),
    /** `home`: the household's network; `away`: through the reverse proxy. */
    lastSeenFrom: Schema.optionalKey(Schema.Literals(["home", "away"])),
  }),
).annotate({ identifier: "Guest" });
export type Guest = typeof Guest.Type;

/** Changes to a guest; absent fields stay as they are. */
export const GuestUpdate = Schema.Struct({
  displayName: Schema.optionalKey(Name),
  access: Schema.optionalKey(AccessPolicy),
}).annotate({ identifier: "GuestUpdate" });
export type GuestUpdate = typeof GuestUpdate.Type;

/** "Invite a guest": who it is for, what they may see and do, and how long the link works. */
export const GuestInviteInput = Schema.Struct({
  name: Name,
  access: AccessPolicy,
  expiry: InviteExpiry,
}).annotate({ identifier: "GuestInviteInput" });
export type GuestInviteInput = typeof GuestInviteInput.Type;

/** Path of the web page that accepts a guest invite; it reads the token from `?token=`. */
export const inviteAcceptPath = "/invite";

/**
 * The invite URL for a token on the server's public origin, like `deviceLinkUrl`:
 * `https://tv.example.com/invite?token=…`. `GuestInvite.url` is built with it.
 */
export const inviteUrl = (origin: string, token: string): string =>
  `${origin.replace(/\/+$/u, "")}${inviteAcceptPath}?token=${encodeURIComponent(token)}`;

const inviteParams = { inviteId: InviteId };
const guestParams = { userId: UserId };

/**
 * Guests (SPEC 7.8), admin only: friends with their own account who sign in from anywhere, with
 * an access policy (channels, collections, may record, stream limit). Removing a guest goes
 * through `profiles.remove`. Invites stay listed until accepted, revoked or expired.
 */
export class GuestsGroup extends HttpApiGroup.make("guests")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(Guest), error: Forbidden }),
    HttpApiEndpoint.get("invites", "/invites", {
      success: Schema.Array(GuestInvite),
      error: Forbidden,
    }),
    HttpApiEndpoint.post("invite", "/invites", {
      payload: GuestInviteInput,
      success: GuestInvite,
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.delete("revokeInvite", "/invites/:inviteId", {
      params: inviteParams,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.patch("update", "/:userId", {
      params: guestParams,
      payload: GuestUpdate,
      success: Guest,
      error: [NotFound, InvalidInput, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/guests")
  .annotateMerge(OpenApi.annotations({ title: "Guests" })) {}

/** The secret token from an invite link. */
export const InviteToken = Schema.Struct({ token: Schema.NonEmptyString }).annotate({
  identifier: "InviteToken",
});
export type InviteToken = typeof InviteToken.Type;

/** What the invite page shows before someone accepts: "Jonas invited you to Slipstream". */
export const InvitePreview = Schema.Struct({
  name: Schema.NonEmptyString,
  invitedBy: Schema.NonEmptyString,
  expiresAt: Schema.optionalKey(Instant),
  access: AccessPolicy,
}).annotate({ identifier: "InvitePreview" });
export type InvitePreview = typeof InvitePreview.Type;

/**
 * Accepting an invite creates the guest account and signs it in, like `auth.login`.
 * `displayName` defaults to the invite's name; with `device`, the result carries a device token.
 */
export const InviteAcceptance = Schema.Struct({
  token: Schema.NonEmptyString,
  username: Name,
  password: Password,
  displayName: Schema.optionalKey(Name),
  device: Schema.optionalKey(DeviceInfo),
}).annotate({ identifier: "InviteAcceptance" });
export type InviteAcceptance = typeof InviteAcceptance.Type;

/**
 * Invites, public: the invite page looks a token up and accepts it. The token travels in the
 * body, never the path, so request logs never hold it. An unknown token answers `NotFound`
 * (entity `invite`); a used, revoked or expired one `InviteInvalid`; a taken username
 * `Conflict` with code `usernameTaken`. Both count against the login rate limit.
 */
export class InvitesGroup extends HttpApiGroup.make("invites")
  .add(
    HttpApiEndpoint.post("lookup", "/lookup", {
      payload: InviteToken,
      success: InvitePreview,
      error: [NotFound, InviteInvalid, RateLimited],
    }),
    HttpApiEndpoint.post("accept", "/accept", {
      payload: InviteAcceptance,
      success: LoginResult,
      error: [NotFound, InviteInvalid, Conflict, InvalidInput, RateLimited],
    }),
  )
  .prefix("/invites")
  .annotateMerge(OpenApi.annotations({ title: "Invites" })) {}
