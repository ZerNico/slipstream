/**
 * Accounts, sessions and devices (PLAN 6.9): first-run setup, password sign-in with rate
 * limiting, device-code sign-in for TVs, revocable device tokens.
 *
 * Bearer secrets are random 256-bit values handed out once; the database keeps only their
 * SHA-256, so a copied database cannot be used to sign in.
 */
import { and, count, eq, gt, lt } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import {
  AlreadySetUp,
  deviceLinkUrl,
  DeviceCodeNotReady,
  Forbidden,
  InvalidCredentials,
  InvalidInput,
  NotFound,
  SetupRequired,
  Unauthorized,
  type DeviceCodeApprovalResult,
  type DeviceCodeGrant,
  type DeviceInfo,
  type LoginRequest,
  type LoginResult,
  type PendingDeviceSignIn,
  type SetupRequest,
} from "@slipstream/api";
import { DAY, type Device, DeviceId, type User, UserId } from "@slipstream/domain";
import { linkOrigin, ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { opt, toInstant } from "../db/codec.ts";
import { deviceCodes, devices, sessions, users } from "../db/schema.ts";
import { newId } from "../ids.ts";
import {
  decoyPasswordHash,
  hashPassword,
  storedUserCode,
  randomToken,
  randomUserCode,
  sha256,
  verifyPassword,
} from "./crypto.ts";
import { type Backoff, type Limit, RateLimiter } from "./rate-limit.ts";
import { Signing } from "./signing.ts";

/** Browser sessions last a month. */
export const BROWSER_SESSION_MILLIS = 30 * DAY;
/** Device tokens last a year and are extended whenever the device is used. */
export const DEVICE_TOKEN_MILLIS = 365 * DAY;
/** How long a TV's sign-in code stays valid. */
export const DEVICE_CODE_MILLIS = 10 * 60_000;
/** How often a TV may poll for its token (RFC 8628 `interval`). */
export const DEVICE_POLL_SECONDS = 5;
/** Last-seen timestamps are written at most this often per session. */
const TOUCH_MILLIS = 60_000;

/** Failed sign-ins allowed per client address before a cool-down. */
export const LOGIN_PER_CLIENT: Limit = { max: 10, windowMillis: 15 * 60_000 };
/** Failed attempts allowed per account secret (PIN, profile switch, password change). */
export const LOGIN_PER_USER: Limit = { max: 5, windowMillis: 15 * 60_000 };
/**
 * Wrong passwords per username: three are free, then every one doubles the wait before the next
 * attempt (2 s, 4 s, 8 s, ... at most 15 minutes). Never a lockout, so someone guessing cannot
 * keep the owner out; a browser or device already signed in as that account skips it.
 */
export const LOGIN_BACKOFF: Backoff = {
  free: 3,
  baseMillis: 2_000,
  maxMillis: 15 * 60_000,
  forgetMillis: 24 * 3_600_000,
};
const DEVICE_CODES_PER_CLIENT: Limit = { max: 10, windowMillis: 10 * 60_000 };

/** A successful sign-in: the API result and, for browsers, what goes into the cookies. */
export interface IssuedSession {
  readonly result: typeof LoginResult.Type;
  /** Browser sign-ins: the session secret for the HTTP-only cookie and its CSRF token. */
  readonly cookie?: { readonly token: string; readonly csrf: string; readonly expiresAt: number };
}

/** The signed-in principal behind a request. */
export interface Principal {
  /** The user as handlers see it; a household device never acts as an admin. */
  readonly user: User;
  readonly sessionId: string;
  readonly deviceId: string | undefined;
  /** The device is a shared household device that switches between profiles. */
  readonly household: boolean;
  /** When the session ends, epoch ms. */
  readonly expiresAt: number;
}

/** Where a request came from: the household's network or outside (through a proxy). */
export type RequestOrigin = "home" | "away";

type UserRow = typeof users.$inferSelect;
type DeviceRow = typeof devices.$inferSelect;

/** A user row as the API shows it (no password hash). */
export const toUser = (
  row: Pick<UserRow, "id" | "username" | "displayName" | "role" | "createdAt">,
): User => ({
  id: UserId.make(row.id),
  username: row.username,
  displayName: row.displayName,
  role: row.role,
  createdAt: toInstant(row.createdAt),
});

/**
 * The user as they act on one sign-in (SPEC 7.8): a shared household device and a guest never
 * act with admin rights, whatever the account's role.
 */
export const actingUser = (
  row: Pick<UserRow, "id" | "username" | "displayName" | "role" | "createdAt" | "kind">,
  onHouseholdDevice: boolean,
): User => {
  const user = toUser(row);
  return user.role === "admin" && (onHouseholdDevice || row.kind === "guest")
    ? { ...user, role: "user" }
    : user;
};

/** A device row as the API shows it. */
export const toDevice = (row: DeviceRow): Device => ({
  id: DeviceId.make(row.id),
  userId: UserId.make(row.userId),
  name: row.name,
  kind: row.kind,
  createdAt: toInstant(row.createdAt),
  ...opt("lastSeenAt", row.lastSeenAt === null ? null : toInstant(row.lastSeenAt)),
  ...opt("revokedAt", row.revokedAt === null ? null : toInstant(row.revokedAt)),
  ...(row.household ? { household: true } : {}),
});

/** Usernames compare case-insensitively and ignore surrounding spaces. */
export const normaliseUsername = (username: string) => username.trim().toLowerCase();

const makeAuth = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const limiter = yield* RateLimiter;
  const signing = yield* Signing;
  const config = yield* ServerConfig;
  const decoy = yield* decoyPasswordHash;

  const userCount = read
    .select({ value: count() })
    .from(users)
    .pipe(
      Effect.map((rows) => rows[0]?.value ?? 0),
      Effect.orDie,
    );

  /** Creates a session row and returns its secret. */
  const createSession = (userId: string, deviceId: string | undefined, lifetime: number) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const token = randomToken();
      const expiresAt = now + lifetime;
      yield* write.insert(sessions).values({
        id: newId(),
        tokenHash: sha256(token),
        userId,
        deviceId: deviceId ?? null,
        createdAt: now,
        expiresAt,
        lastSeenAt: now,
      });
      return { token, expiresAt };
    }).pipe(Effect.orDie);

  const browserSession = (user: UserRow) =>
    Effect.map(
      createSession(user.id, undefined, BROWSER_SESSION_MILLIS),
      ({ token, expiresAt }) =>
        ({
          result: { user: toUser(user), expiresAt: toInstant(expiresAt) },
          cookie: { token, csrf: signing.csrfFor(token), expiresAt },
        }) satisfies IssuedSession,
    );

  const deviceSession = (user: UserRow, info: typeof DeviceInfo.Type, household = false) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const row: DeviceRow = {
        id: newId(),
        userId: user.id,
        name: info.name,
        kind: info.kind,
        createdAt: now,
        lastSeenAt: now,
        revokedAt: null,
        household,
      };
      yield* write.insert(devices).values(row).pipe(Effect.orDie);
      const { token, expiresAt } = yield* createSession(user.id, row.id, DEVICE_TOKEN_MILLIS);
      return {
        result: {
          user: toUser(user),
          device: toDevice(row),
          token,
          expiresAt: toInstant(expiresAt),
        },
      } satisfies IssuedSession;
    });

  const issue = (user: UserRow, device: typeof DeviceInfo.Type | undefined) =>
    device === undefined ? browserSession(user) : deviceSession(user, device);

  const setup = Effect.fn("Auth.setup")(function* (input: typeof SetupRequest.Type) {
    const username = normaliseUsername(input.username);
    if (username === "") {
      return yield* new InvalidInput({ problems: [{ path: "username", code: "required" }] });
    }
    const passwordHash = yield* hashPassword(input.password);
    const created = yield* write
      .transaction((tx) =>
        Effect.gen(function* () {
          const [existing] = yield* tx.select({ value: count() }).from(users);
          if ((existing?.value ?? 0) > 0) return undefined;
          const row: UserRow = {
            id: newId(),
            username,
            displayName: input.displayName.trim(),
            role: "admin",
            passwordHash,
            createdAt: yield* Clock.currentTimeMillis,
            kind: "household",
            avatarTone: "amber",
            pinHash: null,
            access: null,
            lastSeenAt: null,
            lastSeenFrom: null,
          };
          yield* tx.insert(users).values(row);
          return row;
        }),
      )
      .pipe(Effect.orDie);
    if (created === undefined) return yield* new AlreadySetUp();
    yield* Effect.logInfo("First-run setup created the admin account").pipe(
      Effect.annotateLogs({ username }),
    );
    return yield* browserSession(created);
  });

  /**
   * Password sign-in. `signedInAs` is the account the request is already signed in as (a valid
   * session or device credential): signing in again as that same account is the owner, so the
   * per-username backoff does not apply. Anyone else, signed in or not, waits it out.
   *
   * The attempt counts against the client and the username before the password derivation
   * starts, so concurrent guesses cannot slip past the limits; a right password gives the
   * client's count back and clears the username's backoff.
   */
  const login = Effect.fn("Auth.login")(function* (
    input: typeof LoginRequest.Type,
    clientAddress: string,
    signedInAs?: User,
  ) {
    if ((yield* userCount) === 0) return yield* new SetupRequired();
    const username = normaliseUsername(input.username);
    const clientKey = `login:client:${clientAddress}`;
    const userKey = `login:user:${username}`;
    const owner = signedInAs !== undefined && normaliseUsername(signedInAs.username) === username;
    yield* limiter.reserve([
      { key: clientKey, limit: LOGIN_PER_CLIENT },
      ...(owner ? [] : [{ key: userKey, backoff: LOGIN_BACKOFF }]),
    ]);
    const [user] = yield* read
      .select()
      .from(users)
      .where(eq(users.username, username))
      .pipe(Effect.orDie);
    const valid = yield* verifyPassword(input.password, user?.passwordHash ?? decoy);
    if (user === undefined || !valid) {
      yield* Effect.logWarning("Sign-in failed").pipe(
        Effect.annotateLogs({ username, clientAddress }),
      );
      return yield* new InvalidCredentials();
    }
    yield* limiter.refund(clientKey);
    yield* limiter.reset(userKey);
    return yield* issue(user, input.device);
  });

  /**
   * The principal behind a session or device secret. `origin` (home network or away) is kept
   * with the user's last-seen time, for "last seen Sat 14 Nov from outside your network".
   */
  const authenticate = Effect.fn("Auth.authenticate")(function* (
    token: string,
    origin?: RequestOrigin,
  ) {
    if (token === "") return yield* new Unauthorized();
    const now = yield* Clock.currentTimeMillis;
    const [row] = yield* read
      .select({ session: sessions, user: users, household: devices.household })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(devices, eq(devices.id, sessions.deviceId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
      .pipe(Effect.orDie);
    if (row === undefined) return yield* new Unauthorized();
    const { session } = row;
    let expiresAt = session.expiresAt;
    if (now - session.lastSeenAt > TOUCH_MILLIS) {
      expiresAt = session.deviceId === null ? session.expiresAt : now + DEVICE_TOKEN_MILLIS;
      yield* write
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt })
        .where(eq(sessions.id, session.id))
        .pipe(Effect.orDie);
      if (session.deviceId !== null) {
        yield* write
          .update(devices)
          .set({ lastSeenAt: now })
          .where(eq(devices.id, session.deviceId))
          .pipe(Effect.orDie);
      }
    }
    const userSeen = row.user.lastSeenAt;
    if (
      userSeen === null ||
      now - userSeen > TOUCH_MILLIS ||
      (origin !== undefined && origin !== row.user.lastSeenFrom)
    ) {
      yield* write
        .update(users)
        .set({ lastSeenAt: now, ...(origin === undefined ? {} : { lastSeenFrom: origin }) })
        .where(eq(users.id, row.user.id))
        .pipe(Effect.orDie);
    }
    const household = row.household === true;
    return {
      user: actingUser(row.user, household),
      sessionId: session.id,
      deviceId: session.deviceId ?? undefined,
      household,
      expiresAt,
    } satisfies Principal;
  });

  /**
   * Who a session row still signs in, without touching it: `undefined` once it ended, expired,
   * or its device was revoked (revoking deletes the device's sessions). HLS tokens carry the
   * session id and ask this on every playlist request.
   */
  const sessionUser = (sessionId: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const [row] = yield* read
        .select({
          user: users,
          household: devices.household,
          revokedAt: devices.revokedAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .leftJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
        .pipe(Effect.orDie);
      if (row === undefined || row.revokedAt !== null) return undefined;
      return actingUser(row.user, row.household === true);
    });

  const logout = (token: string) =>
    write
      .delete(sessions)
      .where(eq(sessions.tokenHash, sha256(token)))
      .pipe(Effect.asVoid, Effect.orDie);

  const verificationUrl = (userCode: string) => deviceLinkUrl(linkOrigin(config), userCode);

  /** A pending device code by the code the person typed, or why it cannot be used. */
  const pendingCode = (userCode: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const normalised = storedUserCode(userCode);
      const [code] = yield* read
        .select()
        .from(deviceCodes)
        .where(eq(deviceCodes.userCode, normalised))
        .pipe(Effect.orDie);
      if (code === undefined) return yield* new NotFound({ entity: "device", id: normalised });
      if (code.expiresAt <= now || code.status !== "pending") {
        return yield* new DeviceCodeNotReady({ reason: "expired" });
      }
      return code;
    });

  const pendingDeviceCode = (userCode: string) =>
    Effect.map(
      pendingCode(userCode),
      (code) =>
        ({
          userCode: code.userCode,
          device: { name: code.deviceName, kind: code.deviceKind },
          expiresAt: toInstant(code.expiresAt),
        }) satisfies PendingDeviceSignIn,
    );

  const startDeviceCode = Effect.fn("Auth.startDeviceCode")(function* (
    info: typeof DeviceInfo.Type,
    clientAddress: string,
  ) {
    if ((yield* userCount) === 0) return yield* new SetupRequired();
    yield* limiter.consume(`device-code:${clientAddress}`, DEVICE_CODES_PER_CLIENT);
    const now = yield* Clock.currentTimeMillis;
    yield* write.delete(deviceCodes).where(lt(deviceCodes.expiresAt, now)).pipe(Effect.orDie);
    const deviceCode = randomToken();
    const expiresAt = now + DEVICE_CODE_MILLIS;
    // A collision on the 40-bit user code is astronomically rare; try again if it happens.
    const userCode = yield* Effect.suspend(() => {
      const code = randomUserCode();
      return write
        .insert(deviceCodes)
        .values({
          deviceCodeHash: sha256(deviceCode),
          userCode: code,
          deviceName: info.name,
          deviceKind: info.kind,
          status: "pending",
          createdAt: now,
          expiresAt,
        })
        .pipe(Effect.as(code));
    }).pipe(Effect.retry({ times: 3 }), Effect.orDie);
    return {
      deviceCode,
      userCode,
      verificationUrl: verificationUrl(userCode),
      expiresAt: toInstant(expiresAt),
      intervalSeconds: DEVICE_POLL_SECONDS,
    } satisfies typeof DeviceCodeGrant.Type;
  });

  const pollDeviceCode = Effect.fn("Auth.pollDeviceCode")(function* (deviceCode: string) {
    const now = yield* Clock.currentTimeMillis;
    const hash = sha256(deviceCode);
    const [code] = yield* read
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.deviceCodeHash, hash))
      .pipe(Effect.orDie);
    if (code === undefined) return yield* new DeviceCodeNotReady({ reason: "expired" });
    const forget = write
      .delete(deviceCodes)
      .where(eq(deviceCodes.deviceCodeHash, hash))
      .pipe(Effect.orDie);
    if (code.expiresAt <= now) {
      yield* forget;
      return yield* new DeviceCodeNotReady({ reason: "expired" });
    }
    if (code.status === "denied") {
      yield* forget;
      return yield* new DeviceCodeNotReady({ reason: "denied" });
    }
    const tooSoon =
      code.lastPolledAt !== null && now - code.lastPolledAt < DEVICE_POLL_SECONDS * 1000 - 250;
    yield* write
      .update(deviceCodes)
      .set({ lastPolledAt: now })
      .where(eq(deviceCodes.deviceCodeHash, hash))
      .pipe(Effect.orDie);
    if (tooSoon) return yield* new DeviceCodeNotReady({ reason: "slowDown" });
    if (code.status === "pending" || code.userId === null) {
      return yield* new DeviceCodeNotReady({ reason: "pending" });
    }
    const [user] = yield* read
      .select()
      .from(users)
      .where(eq(users.id, code.userId))
      .pipe(Effect.orDie);
    yield* forget;
    if (user === undefined) return yield* new DeviceCodeNotReady({ reason: "denied" });
    return yield* deviceSession(
      user,
      { name: code.deviceName, kind: code.deviceKind },
      code.household,
    );
  });

  const approveDeviceCode = Effect.fn("Auth.approveDeviceCode")(function* (
    approver: User,
    request: {
      readonly userCode: string;
      readonly approve: boolean;
      readonly userId?: string;
      readonly household?: boolean;
    },
  ) {
    const code = yield* pendingCode(request.userCode);
    const device = { name: code.deviceName, kind: code.deviceKind };
    if (!request.approve) {
      yield* write
        .update(deviceCodes)
        .set({ status: "denied" })
        .where(eq(deviceCodes.deviceCodeHash, code.deviceCodeHash))
        .pipe(Effect.orDie);
      return { device } satisfies DeviceCodeApprovalResult;
    }
    const userId = request.userId ?? approver.id;
    const household = request.household === true;
    // Signing a TV in as another household profile is for admins.
    if (userId !== approver.id) yield* requireAdmin(approver);
    const [target] = yield* read
      .select({ id: users.id, kind: users.kind })
      .from(users)
      .where(eq(users.id, userId))
      .pipe(Effect.orDie);
    if (target === undefined) return yield* new NotFound({ entity: "user", id: userId });
    // Shared household devices are for household profiles; guests cannot approve or be one.
    // (Admins are always household profiles, so a guest approver is the target here.)
    if (household && target.kind !== "household") return yield* new Forbidden();
    yield* write
      .update(deviceCodes)
      .set({ status: "approved", userId, household })
      .where(eq(deviceCodes.deviceCodeHash, code.deviceCodeHash))
      .pipe(Effect.orDie);
    return { device, userId: UserId.make(userId) } satisfies DeviceCodeApprovalResult;
  });

  const ownedDevice = (actor: User, deviceId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read
        .select()
        .from(devices)
        .where(eq(devices.id, deviceId))
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "device", id: deviceId });
      if (row.userId !== actor.id && actor.role !== "admin") return yield* new Forbidden();
      return row;
    });

  return {
    setupRequired: Effect.map(userCount, (value) => value === 0),
    setup,
    login,
    /** Signs a user row in: a browser session, or a new device with `device`. */
    issue,
    authenticate,
    sessionUser,
    logout,
    startDeviceCode,
    pollDeviceCode,
    pendingDeviceCode,
    approveDeviceCode,
    /** The name of a paired device, for "arte on Kitchen Shield". */
    deviceName: (deviceId: string) =>
      read
        .select({ name: devices.name })
        .from(devices)
        .where(eq(devices.id, deviceId))
        .pipe(
          Effect.map((rows) => rows[0]?.name),
          Effect.orDie,
        ),
    listDevices: (actor: User) =>
      (actor.role === "admin"
        ? read.select().from(devices)
        : read.select().from(devices).where(eq(devices.userId, actor.id))
      ).pipe(
        Effect.map((rows) => rows.map(toDevice)),
        Effect.orDie,
      ),
    renameDevice: (actor: User, deviceId: string, name: string) =>
      Effect.gen(function* () {
        const row = yield* ownedDevice(actor, deviceId);
        yield* write.update(devices).set({ name }).where(eq(devices.id, row.id)).pipe(Effect.orDie);
        return toDevice({ ...row, name });
      }),
    revokeDevice: (actor: User, deviceId: string) =>
      Effect.gen(function* () {
        const row = yield* ownedDevice(actor, deviceId);
        const now = yield* Clock.currentTimeMillis;
        yield* write
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.delete(sessions).where(eq(sessions.deviceId, row.id));
              yield* tx.update(devices).set({ revokedAt: now }).where(eq(devices.id, row.id));
            }),
          )
          .pipe(Effect.orDie);
      }),
  };
});

/** Accounts, sessions and devices. */
export class Auth extends Context.Service<Auth, Effect.Success<typeof makeAuth>>()(
  "@slipstream/server/Auth",
) {
  static readonly layer = Layer.effect(Auth, makeAuth);
}

/** Fails with `Forbidden` unless the user is an admin. */
export const requireAdmin = (user: User): Effect.Effect<void, Forbidden> =>
  user.role === "admin" ? Effect.void : Effect.fail(new Forbidden());
