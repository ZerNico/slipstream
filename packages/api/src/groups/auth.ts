import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  defaultProfile,
  Device,
  DeviceKind,
  Instant,
  type Profile,
  User,
  UserId,
} from "@slipstream/domain";
import {
  AlreadySetUp,
  DeviceCodeNotReady,
  Forbidden,
  InvalidCredentials,
  InvalidInput,
  NotFound,
  RateLimited,
  SetupRequired,
} from "../errors.ts";
import { Authentication } from "../security.ts";
import { Name, Password, Secret } from "../primitives.ts";

/** The device a sign-in is for, so it shows up in the device list. */
export const DeviceInfo = Schema.Struct({
  name: Name,
  kind: DeviceKind,
}).annotate({ identifier: "DeviceInfo" });
export type DeviceInfo = typeof DeviceInfo.Type;

/** First-run setup: creates the admin account. */
export const SetupRequest = Schema.Struct({
  username: Name,
  displayName: Name,
  password: Password,
}).annotate({ identifier: "SetupRequest" });
export type SetupRequest = typeof SetupRequest.Type;

/**
 * Username and password. Browsers get a session cookie; with `device`, the response also
 * carries a long-lived device token for the app.
 */
export const LoginRequest = Schema.Struct({
  username: Name,
  password: Secret,
  device: Schema.optionalKey(DeviceInfo),
}).annotate({ identifier: "LoginRequest" });
export type LoginRequest = typeof LoginRequest.Type;

/** A signed-in user and, for devices, their token. */
export const LoginResult = Schema.Struct({
  user: User,
  device: Schema.optionalKey(Device),
  token: Schema.optionalKey(Schema.String),
  expiresAt: Instant,
}).annotate({ identifier: "LoginResult" });
export type LoginResult = typeof LoginResult.Type;

/** Path of the web page that approves a TV sign-in; it reads the code from `?code=`. */
export const deviceLinkPath = "/link";

/**
 * A user code as people type or scan it: letters and digits only, upper case ("qk7·4rm" is
 * "QK74RM"). Codes leave out 0/O and 1/I, so nothing is guessed about those; the server decides
 * validity.
 */
export const normaliseUserCode = (input: string): string =>
  input.replaceAll(/[^A-Za-z0-9]/gu, "").toUpperCase();

/**
 * A user code the way the TV and the approve pages show it, split in the middle: "QK74RM" is
 * "QK7·4RM". Codes of four characters or fewer stay whole.
 */
export const formatUserCode = (code: string): string => {
  const clean = normaliseUserCode(code);
  if (clean.length <= 4) return clean;
  const half = Math.ceil(clean.length / 2);
  return `${clean.slice(0, half)}·${clean.slice(half)}`;
};

/**
 * The approve-page URL for a user code on a server's public origin, like RFC 8628's
 * `verification_uri_complete`: `https://tv.example.com/link?code=QK74RM`.
 */
export const deviceLinkUrl = (origin: string, userCode: string): string =>
  `${origin.replace(/\/+$/u, "")}${deviceLinkPath}?code=${encodeURIComponent(userCode)}`;

/**
 * What the TV shows: a QR code for `verificationUrl` plus the short `userCode`.
 * `verificationUrl` already carries the code (see {@link deviceLinkUrl}), so scanning it opens
 * the approve page with the code filled in; the TV can show the bare `/link` address beside it.
 */
export const DeviceCodeGrant = Schema.Struct({
  deviceCode: Schema.String,
  userCode: Schema.String,
  verificationUrl: Schema.String,
  expiresAt: Instant,
  intervalSeconds: Schema.Int,
}).annotate({ identifier: "DeviceCodeGrant" });
export type DeviceCodeGrant = typeof DeviceCodeGrant.Type;

/** A device-code sign-in waiting on the approve page ("Sign in Living Room Shield?"). */
export const PendingDeviceSignIn = Schema.Struct({
  userCode: Schema.String,
  device: DeviceInfo,
  expiresAt: Instant,
}).annotate({ identifier: "PendingDeviceSignIn" });
export type PendingDeviceSignIn = typeof PendingDeviceSignIn.Type;

/**
 * Approves or blocks a TV sign-in. `userId` signs the TV in as another household profile;
 * only admins may set it to someone other than themselves (`Forbidden` otherwise). `household`
 * makes it a shared device ("Household · pick on the TV"): it starts as `userId` (default the
 * approver), switches between household profiles with `profiles.switch`, and never acts with
 * admin rights. Guests cannot approve household devices.
 */
export const DeviceCodeApproval = Schema.Struct({
  userCode: Schema.String,
  approve: Schema.Boolean,
  userId: Schema.optionalKey(UserId),
  household: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "DeviceCodeApproval" });
export type DeviceCodeApproval = typeof DeviceCodeApproval.Type;

/** The request for "Sign in on TV" as `profile`; `userId` is only sent for someone else. */
export const approveAs = (
  userCode: string,
  profile: UserId,
  me: { readonly id: UserId },
): DeviceCodeApproval =>
  profile === me.id ? { userCode, approve: true } : { userCode, approve: true, userId: profile };

/**
 * The request for "Sign in as the household": a shared TV that switches between the non-admin
 * profiles and never acts with admin rights, starting on `defaultProfile`.
 */
export const approveHousehold = (
  userCode: string,
  profiles: readonly Pick<Profile, "id" | "role">[],
  me: { readonly id: UserId },
): DeviceCodeApproval => ({
  userCode,
  approve: true,
  household: true,
  userId: defaultProfile(profiles, me),
});

/** The request for "This isn't my TV". */
export const blockSignIn = (userCode: string): DeviceCodeApproval => ({
  userCode,
  approve: false,
});

/** How a lookup or an answer failed, as the approve screens explain it. */
export type ApproveProblem = "invalidCode" | "forbidden" | "failed";

/**
 * Reads a failed lookup or approval: an unknown, expired or already answered code means "get a
 * new one on the TV"; anything else is a plain failure to retry.
 */
export const approveProblem = (error: unknown): ApproveProblem => {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined;
  if (tag === "NotFound" || tag === "DeviceCodeNotReady") return "invalidCode";
  if (tag === "Forbidden") return "forbidden";
  return "failed";
};

/** The device that was approved or blocked, and the profile it signed in as. */
export const DeviceCodeApprovalResult = Schema.Struct({
  device: DeviceInfo,
  /** Absent when the sign-in was blocked. */
  userId: Schema.optionalKey(UserId),
}).annotate({ identifier: "DeviceCodeApprovalResult" });
export type DeviceCodeApprovalResult = typeof DeviceCodeApprovalResult.Type;

/** Whether first-run setup still has to create the admin account. */
export const SetupStatus = Schema.Struct({ required: Schema.Boolean }).annotate({
  identifier: "SetupStatus",
});
export type SetupStatus = typeof SetupStatus.Type;

/** Auth: setup, password login, device-code login for TVs. */
export class AuthGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("setupStatus", "/setup", {
      success: SetupStatus,
    }),
    HttpApiEndpoint.post("setup", "/setup", {
      payload: SetupRequest,
      success: LoginResult,
      error: [AlreadySetUp, InvalidInput],
    }),
    HttpApiEndpoint.post("login", "/login", {
      payload: LoginRequest,
      success: LoginResult,
      error: [InvalidCredentials, RateLimited, SetupRequired],
    }),
    HttpApiEndpoint.post("startDeviceCode", "/device-code", {
      payload: DeviceInfo,
      success: DeviceCodeGrant,
      error: [RateLimited, SetupRequired],
    }),
    HttpApiEndpoint.post("pollDeviceCode", "/device-code/token", {
      payload: Schema.Struct({ deviceCode: Schema.String }),
      success: LoginResult,
      error: DeviceCodeNotReady,
    }),
    HttpApiEndpoint.get("pendingDeviceCode", "/device-code/:userCode", {
      params: { userCode: Schema.String },
      success: PendingDeviceSignIn,
      error: [NotFound, DeviceCodeNotReady],
    }).middleware(Authentication),
    HttpApiEndpoint.post("approveDeviceCode", "/device-code/approve", {
      payload: DeviceCodeApproval,
      success: DeviceCodeApprovalResult,
      error: [NotFound, DeviceCodeNotReady, Forbidden],
    }).middleware(Authentication),
    HttpApiEndpoint.post("logout", "/logout", {
      success: HttpApiSchema.NoContent,
    }).middleware(Authentication),
    HttpApiEndpoint.get("me", "/me", { success: User }).middleware(Authentication),
  )
  .prefix("/auth")
  .annotateMerge(OpenApi.annotations({ title: "Auth" })) {}
