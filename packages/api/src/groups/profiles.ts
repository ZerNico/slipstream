import { Schema, Struct } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  AccessPolicy,
  AvatarTone,
  Pin,
  PinChange,
  Profile,
  Role,
  UserId,
} from "@slipstream/domain";
import {
  Conflict,
  Forbidden,
  InvalidCredentials,
  InvalidInput,
  NotFound,
  ProfileLocked,
  RateLimited,
} from "../errors.ts";
import { Authentication } from "../security.ts";
import { LoginResult } from "./auth.ts";
import { Name, Password, Secret } from "../primitives.ts";

/**
 * A username and password, for a profile that also signs in on its own (a phone, a browser
 * elsewhere) instead of only being switched to.
 */
export const ProfileLogin = Schema.Struct({
  username: Name,
  password: Password,
}).annotate({ identifier: "ProfileLogin" });
export type ProfileLogin = typeof ProfileLogin.Type;

/**
 * What an admin sends to add a household profile ("Add profile": name, picture, optional PIN).
 * Without `login` the profile has no password; people reach it by switching on a household
 * device or browser, so an admin profile then needs a PIN. `role` defaults to `user`, `access`
 * to full access. A taken username answers `Conflict` with code `usernameTaken`.
 */
export const ProfileInput = Schema.Struct({
  displayName: Name,
  avatarTone: AvatarTone,
  role: Schema.optionalKey(Role),
  pin: Schema.optionalKey(Pin),
  access: Schema.optionalKey(AccessPolicy),
  login: Schema.optionalKey(ProfileLogin),
}).annotate({ identifier: "ProfileInput" });
export type ProfileInput = typeof ProfileInput.Type;

/**
 * A partial update; absent fields stay as they are. Everyone may change their own name and
 * avatar, and their own password when `currentPassword` is right (a wrong one answers
 * `InvalidInput` with problem `{ path: "currentPassword", code: "incorrect" }`). Only admins
 * change roles, access and other people's passwords; a reset ends that person's browser
 * sessions. A new password of your own ends your other sessions and revokes your other devices;
 * wrong current passwords count against the sign-in rate limit (`RateLimited`). Guests never
 * become admins. Demoting the last admin answers `Conflict` with code `lastAdmin`.
 */
export const ProfileUpdate = Schema.Struct({
  displayName: Schema.optionalKey(Name),
  avatarTone: Schema.optionalKey(AvatarTone),
  role: Schema.optionalKey(Role),
  access: Schema.optionalKey(AccessPolicy),
  password: Schema.optionalKey(Password),
  /** Required when someone changes their own password; ignored for admins changing others'. */
  currentPassword: Schema.optionalKey(Secret),
}).annotate({ identifier: "ProfileUpdate" });
export type ProfileUpdate = typeof ProfileUpdate.Type;

/** The domain's `PinChange`, with the current PIN capped like every secret the server reads. */
const PinChangeRequest = PinChange.mapFields(
  Struct.assign({ currentPin: Schema.optionalKey(Secret) }),
).annotate({ identifier: "PinChange" });

/** A PIN to check. */
export const PinCheck = Schema.Struct({ pin: Secret }).annotate({
  identifier: "PinCheck",
});
export type PinCheck = typeof PinCheck.Type;

/**
 * Switches this browser session or household device to another household profile. `secret` is
 * the target's PIN, or for an admin profile without a PIN its password; leave it out when the
 * target has neither lock (the server answers `ProfileLocked` with what it needs).
 */
export const ProfileSwitch = Schema.Struct({
  secret: Schema.optionalKey(Secret),
}).annotate({ identifier: "ProfileSwitch" });
export type ProfileSwitch = typeof ProfileSwitch.Type;

const params = { userId: UserId };

/**
 * Household profiles (SPEC 7.8): the avatar menu's switcher, Settings › Users & devices and the
 * TV's profile picker. Every profile has its own watched state, resume positions, continue
 * watching and rules (all keyed by user id already).
 *
 * - `list`: household profiles for household callers; a guest gets only itself.
 * - `me`: the caller's own profile with its access policy, which clients use to hide what the
 *   server filters anyway (admin-only settings, "Goes to" choices, the storage meter).
 * - `create`, `remove`, role and access changes: admins. Removing a profile or guest revokes
 *   its devices and sessions and takes its rules with it; recordings it shares with others
 *   stay theirs. Admins cannot remove themselves or the last admin.
 * - `switch`: answers like `auth.login`; browsers get a new session cookie, a household device
 *   keeps its token and now acts as the profile. Guests cannot switch or be switched to
 *   (`Forbidden`); wrong secrets count against the same rate limit as logins.
 */
export class ProfilesGroup extends HttpApiGroup.make("profiles")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(Profile) }),
    HttpApiEndpoint.get("me", "/me", { success: Profile }),
    HttpApiEndpoint.post("create", "/", {
      payload: ProfileInput,
      success: Profile,
      error: [InvalidInput, Conflict, Forbidden],
    }),
    HttpApiEndpoint.patch("update", "/:userId", {
      params,
      payload: ProfileUpdate,
      success: Profile,
      error: [NotFound, InvalidInput, Conflict, RateLimited, Forbidden],
    }),
    HttpApiEndpoint.delete("remove", "/:userId", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Conflict, Forbidden],
    }),
    HttpApiEndpoint.put("setPin", "/:userId/pin", {
      params,
      payload: PinChangeRequest,
      success: HttpApiSchema.NoContent,
      error: [NotFound, InvalidCredentials, RateLimited, Forbidden],
    }),
    HttpApiEndpoint.post("verifyPin", "/:userId/pin/verify", {
      params,
      payload: PinCheck,
      success: HttpApiSchema.NoContent,
      error: [NotFound, InvalidCredentials, RateLimited, Forbidden],
    }),
    HttpApiEndpoint.post("switch", "/:userId/switch", {
      params,
      payload: ProfileSwitch,
      success: LoginResult,
      error: [NotFound, ProfileLocked, InvalidCredentials, RateLimited, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/profiles")
  .annotateMerge(OpenApi.annotations({ title: "Profiles" })) {}
