/**
 * Household profiles (SPEC 7.8, PLAN 6.9): the avatar menu's switcher, Settings › Users &
 * devices and the TV's profile picker, and the one place accounts are added, changed and
 * removed. A profile is a `users` row; profiles added here are of kind `household`, and without
 * a `login` they have no password and are reached by switching on a household device or browser.
 * Optional PINs are scrypt-hashed like passwords, and wrong PINs count against the sign-in rate
 * limit. There is always at least one admin, admins cannot delete themselves, and deleting an
 * account takes its devices, sessions and rules with it (foreign keys cascade); recordings it
 * shared with others stay theirs.
 *
 * Switching keeps the signed-in thing and changes who it acts as: a browser gets a new session
 * (the old one ends), a household device keeps its token and now acts as the profile. Guests
 * cannot switch or be switched to.
 */
import { and, count, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import {
  Conflict,
  type ConflictCode,
  Forbidden,
  type InputProblem,
  InvalidCredentials,
  InvalidInput,
  NotFound,
  type ProfileInput,
  ProfileLocked,
  type ProfileUpdate,
} from "@slipstream/api";
import {
  type AccessPolicy,
  type PinChange,
  type Profile,
  type User,
  UserId,
} from "@slipstream/domain";
import { hashPassword, verifyPassword } from "../auth/crypto.ts";
import { RateLimiter } from "../auth/rate-limit.ts";
import {
  actingUser,
  Auth,
  type IssuedSession,
  LOGIN_PER_CLIENT,
  LOGIN_PER_USER,
  normaliseUsername,
  type Principal,
  requireAdmin,
  toDevice,
} from "../auth/service.ts";
import { Db, type Database } from "../db/client.ts";
import { chunks, toInstant } from "../db/codec.ts";
import {
  channels,
  collections,
  devices,
  recordingDeclines,
  recordingOwners,
  rules,
  sessions,
  users,
} from "../db/schema.ts";
import { effectiveAccess, loadViewer } from "../household/viewer.ts";
import { newId } from "../ids.ts";
import { EventBus } from "../events.ts";
import { liveChannel } from "../channels/lineup.ts";

type UserRow = typeof users.$inferSelect;

/**
 * Stored instead of a password for profiles that have none. It is not a scrypt hash, so it never
 * verifies (and still costs a full derivation, see `verifyPassword`).
 */
export const NO_PASSWORD = "!";

/** A user row as the household sees it. */
export const toProfile = (row: UserRow): Profile => {
  // Guests are never admins (a row saying otherwise does not make them one).
  const role = row.kind === "guest" ? "user" : row.role;
  return {
    id: UserId.make(row.id),
    displayName: row.displayName,
    role,
    kind: row.kind,
    avatarTone: row.avatarTone,
    hasPin: row.pinHash !== null,
    access: effectiveAccess(role, row.access),
    createdAt: toInstant(row.createdAt),
  };
};

/**
 * Checks that every channel and collection an access policy names exists. Problems point into
 * the payload, e.g. `access.channelIds.2`.
 */
export const accessProblems = (db: Database, access: AccessPolicy, path = "access") =>
  Effect.gen(function* () {
    const problems: Array<InputProblem> = [];
    if (access.channelIds !== undefined && access.channelIds.length > 0) {
      const rows = yield* db
        .select({ id: channels.id })
        .from(channels)
        .where(liveChannel)
        .pipe(Effect.orDie);
      const known = new Set(rows.map((row) => row.id));
      access.channelIds.forEach((id, index) => {
        if (!known.has(id)) {
          problems.push({ path: `${path}.channelIds.${index}`, code: "unknownChannel" });
        }
      });
    }
    if (access.collectionIds !== undefined && access.collectionIds.length > 0) {
      const rows = yield* db.select({ id: collections.id }).from(collections).pipe(Effect.orDie);
      const known = new Set(rows.map((row) => row.id));
      access.collectionIds.forEach((id, index) => {
        if (!known.has(id)) {
          problems.push({ path: `${path}.collectionIds.${index}`, code: "unknownCollection" });
        }
      });
    }
    return problems;
  });

/** Recordings handed on per statement, under SQLite's variable limit. */
const ROWS_PER_STATEMENT = 200;

const conflict = (code: ConflictCode) => new Conflict({ code });

/** What switching to `target` asks for: its PIN, an admin's password, or nothing. */
const lockOf = (actor: User, target: UserRow): "pin" | "password" | undefined => {
  if (target.id === actor.id) return undefined;
  if (target.pinHash !== null) return "pin";
  return target.role === "admin" ? "password" : undefined;
};

const makeProfiles = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const auth = yield* Auth;
  const limiter = yield* RateLimiter;
  const bus = yield* EventBus;

  const findRow = (userId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read.select().from(users).where(eq(users.id, userId)).pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "user", id: userId });
      return row;
    });

  const otherAdmins = (userId: string) =>
    read
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.id, userId)))
      .pipe(
        Effect.map((rows) => rows[0]?.value ?? 0),
        Effect.orDie,
      );

  const usernameTaken = (username: string) =>
    read
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .pipe(
        Effect.map((rows) => rows.length > 0),
        Effect.orDie,
      );

  /**
   * Checks a secret (PIN or password) for `target` under the sign-in rate limit: per client
   * address and per account. The attempt is counted against both before the derivation starts
   * (`reserve`), so concurrent guesses cannot slip past the limit; a right one gives the
   * client's count back and clears the account's.
   */
  const checkSecret = (target: UserRow, secret: string, hash: string, clientAddress: string) =>
    Effect.gen(function* () {
      const clientKey = `login:client:${clientAddress}`;
      const userKey = `secret:user:${target.id}`;
      yield* limiter.reserve([
        { key: clientKey, limit: LOGIN_PER_CLIENT },
        { key: userKey, limit: LOGIN_PER_USER },
      ]);
      if (!(yield* verifyPassword(secret, hash))) {
        yield* Effect.logWarning("Wrong profile secret").pipe(
          Effect.annotateLogs({ profile: target.id, clientAddress }),
        );
        return yield* new InvalidCredentials();
      }
      yield* limiter.refund(clientKey);
      yield* limiter.reset(userKey);
    });

  const list = (actor: User) =>
    Effect.gen(function* () {
      const viewer = yield* loadViewer(read, actor);
      const rows = yield* read
        .select()
        .from(users)
        .where(viewer.kind === "guest" ? eq(users.id, actor.id) : eq(users.kind, "household"))
        .orderBy(users.createdAt)
        .pipe(Effect.orDie);
      return rows.map(toProfile);
    });

  const me = (actor: User) =>
    Effect.gen(function* () {
      const row = yield* findRow(actor.id).pipe(Effect.orDie);
      // A household device acts without admin rights; `me` says so.
      return { ...toProfile({ ...row, role: actor.role }) } satisfies Profile;
    });

  const create = Effect.fn("Profiles.create")(function* (actor: User, input: ProfileInput) {
    yield* requireAdmin(actor);
    const displayName = input.displayName.trim();
    const role = input.role ?? "user";
    const username =
      input.login === undefined ? undefined : normaliseUsername(input.login.username);
    const problems: Array<InputProblem> = [];
    if (displayName === "") problems.push({ path: "displayName", code: "required" });
    if (username === "") problems.push({ path: "login.username", code: "required" });
    // An admin profile without a password needs a PIN, or nobody could ever switch to it.
    if (role === "admin" && input.pin === undefined && input.login === undefined) {
      problems.push({ path: "pin", code: "requiredForAdmin" });
    }
    if (input.access !== undefined) problems.push(...(yield* accessProblems(read, input.access)));
    if (problems.length > 0) return yield* new InvalidInput({ problems });
    if (username !== undefined && (yield* usernameTaken(username))) {
      return yield* conflict("usernameTaken");
    }
    const id = newId();
    const row: UserRow = {
      id,
      username: username ?? `profile-${id}`,
      displayName,
      role,
      passwordHash:
        input.login === undefined ? NO_PASSWORD : yield* hashPassword(input.login.password),
      createdAt: yield* Clock.currentTimeMillis,
      kind: "household",
      avatarTone: input.avatarTone,
      pinHash: input.pin === undefined ? null : yield* hashPassword(input.pin),
      access: input.access ?? null,
      lastSeenAt: null,
      lastSeenFrom: null,
    };
    yield* write.insert(users).values(row).pipe(Effect.orDie);
    yield* Effect.logInfo("Profile created").pipe(Effect.annotateLogs({ profile: id }));
    return toProfile(row);
  });

  /**
   * Changes a profile. `principal` and `clientAddress` describe the request: changing your own
   * password checks the current one under the sign-in rate limit, and ends every other session
   * and device of yours (the one making the change stays signed in).
   */
  const update = Effect.fn("Profiles.update")(function* (
    actor: User,
    userId: string,
    patch: ProfileUpdate,
    principal: Pick<Principal, "sessionId" | "deviceId">,
    clientAddress: string,
  ) {
    const self = actor.id === userId;
    if (!self) yield* requireAdmin(actor);
    const row = yield* findRow(userId);
    if ((patch.role !== undefined && patch.role !== row.role) || patch.access !== undefined) {
      yield* requireAdmin(actor);
    }
    // Guests never become admins, whoever asks.
    if (patch.role === "admin" && row.kind === "guest") {
      return yield* new InvalidInput({ problems: [{ path: "role", code: "guestAdmin" }] });
    }
    // Your own password needs the current one; admins reset other people's without it.
    if (patch.password !== undefined && self) {
      if (patch.currentPassword === undefined) {
        return yield* new InvalidInput({
          problems: [{ path: "currentPassword", code: "required" }],
        });
      }
      yield* checkSecret(row, patch.currentPassword, row.passwordHash, clientAddress).pipe(
        Effect.catchTag("InvalidCredentials", () =>
          Effect.fail(
            new InvalidInput({ problems: [{ path: "currentPassword", code: "incorrect" }] }),
          ),
        ),
      );
    }
    const displayName = patch.displayName?.trim();
    const problems: Array<InputProblem> = [];
    if (displayName === "") problems.push({ path: "displayName", code: "required" });
    if (patch.access !== undefined) problems.push(...(yield* accessProblems(read, patch.access)));
    if (problems.length > 0) return yield* new InvalidInput({ problems });
    if (patch.role === "user" && row.role === "admin" && (yield* otherAdmins(userId)) === 0) {
      return yield* conflict("lastAdmin");
    }
    const changes = {
      ...(displayName === undefined ? {} : { displayName }),
      ...(patch.avatarTone === undefined ? {} : { avatarTone: patch.avatarTone }),
      ...(patch.role === undefined ? {} : { role: patch.role }),
      ...(patch.access === undefined ? {} : { access: patch.access }),
      ...(patch.password === undefined
        ? {}
        : { passwordHash: yield* hashPassword(patch.password) }),
    };
    if (Object.keys(changes).length > 0) {
      yield* write
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.update(users).set(changes).where(eq(users.id, userId));
            // Someone else reset the password: their browser sessions end; paired devices stay.
            if (patch.password !== undefined && !self) {
              yield* tx
                .delete(sessions)
                .where(and(eq(sessions.userId, userId), isNull(sessions.deviceId)));
            }
            // A new password of your own signs out everything else of yours: other browsers and
            // every other device (revoked), in case the old password was known to someone.
            if (patch.password !== undefined && self) {
              yield* tx
                .delete(sessions)
                .where(and(eq(sessions.userId, userId), ne(sessions.id, principal.sessionId)));
              const now = yield* Clock.currentTimeMillis;
              yield* tx
                .update(devices)
                .set({ revokedAt: now })
                .where(
                  and(
                    eq(devices.userId, userId),
                    isNull(devices.revokedAt),
                    principal.deviceId === undefined
                      ? undefined
                      : ne(devices.id, principal.deviceId),
                  ),
                );
            }
          }),
        )
        .pipe(Effect.orDie);
      // A new role or access changes what the person may see, and so their guide repeats.
      if (patch.role !== undefined || patch.access !== undefined) {
        yield* bus.publishHouseholdChanged;
      }
    }
    return toProfile({ ...row, ...changes });
  });

  const remove = Effect.fn("Profiles.remove")(function* (actor: User, userId: string) {
    yield* requireAdmin(actor);
    if (actor.id === userId) return yield* conflict("deleteSelf");
    const row = yield* findRow(userId);
    if (row.role === "admin" && (yield* otherAdmins(userId)) === 0) {
      return yield* conflict("lastAdmin");
    }
    // Devices, sessions, device codes, rules, ownerships, history and playback states cascade.
    // Collections that follow the person's series recordings keep today's conditions as their
    // own first (§3.4): the database refuses to delete a followed rule, so a miss fails loudly.
    const now = yield* Clock.currentTimeMillis;
    const handedOn = yield* write
      .transaction((tx) =>
        Effect.gen(function* () {
          const others = tx
            .select({ id: recordingOwners.recordingId })
            .from(recordingOwners)
            .where(ne(recordingOwners.userId, userId));
          // What only they owned stays in the library, passed to the deleting admin: every
          // recording has an owner.
          const soleOwned = (yield* tx
            .select({ id: recordingOwners.recordingId })
            .from(recordingOwners)
            .where(
              and(
                eq(recordingOwners.userId, userId),
                notInArray(recordingOwners.recordingId, others),
              ),
            )).map((owned) => owned.id);
          for (const batch of chunks(soleOwned, ROWS_PER_STATEMENT)) {
            yield* tx
              .delete(recordingDeclines)
              .where(
                and(
                  eq(recordingDeclines.userId, actor.id),
                  inArray(recordingDeclines.recordingId, [...batch]),
                ),
              );
            yield* tx.insert(recordingOwners).values(
              batch.map((recordingId) => ({
                recordingId,
                userId: actor.id,
                addedAt: now,
                addedByRuleId: null,
              })),
            );
          }
          yield* tx
            .update(collections)
            .set({ ruleId: null })
            .where(
              inArray(
                collections.ruleId,
                tx.select({ id: rules.id }).from(rules).where(eq(rules.ownerId, userId)),
              ),
            );
          yield* tx.delete(users).where(eq(users.id, userId));
          return soleOwned;
        }),
      )
      .pipe(Effect.orDie);
    yield* bus.publishHouseholdChanged;
    if (handedOn.length > 0) {
      yield* Effect.logInfo("Recordings of a deleted account passed to the admin").pipe(
        Effect.annotateLogs({ profile: row.id, recordings: handedOn.length }),
      );
    }
    yield* Effect.logInfo("Account deleted").pipe(Effect.annotateLogs({ profile: row.id }));
  });

  /** A household profile whose PIN the actor may change or check; guests have none. */
  const pinTarget = (actor: User, userId: string) =>
    Effect.gen(function* () {
      const viewer = yield* loadViewer(read, actor);
      const row = yield* findRow(userId);
      if (viewer.kind !== "household" || row.kind !== "household") return yield* new Forbidden();
      return row;
    });

  const setPin = Effect.fn("Profiles.setPin")(function* (
    actor: User,
    userId: string,
    change: PinChange,
    clientAddress: string,
  ) {
    const self = actor.id === userId;
    if (!self) yield* requireAdmin(actor);
    const row = yield* pinTarget(actor, userId);
    // Changing your own PIN needs the current one; admins reset other people's without it.
    if (self && row.pinHash !== null) {
      yield* checkSecret(row, change.currentPin ?? "", row.pinHash, clientAddress);
    }
    if (change.pin === null && row.role === "admin") {
      // Without a PIN an admin profile asks for its password, which a profile may not have.
      if (row.passwordHash === NO_PASSWORD) return yield* new Forbidden();
    }
    const pinHash = change.pin === null ? null : yield* hashPassword(change.pin);
    yield* write.update(users).set({ pinHash }).where(eq(users.id, userId)).pipe(Effect.orDie);
  });

  const verifyPin = Effect.fn("Profiles.verifyPin")(function* (
    actor: User,
    userId: string,
    pin: string,
    clientAddress: string,
  ) {
    const row = yield* pinTarget(actor, userId);
    yield* checkSecret(row, pin, row.pinHash ?? NO_PASSWORD, clientAddress);
  });

  const switchTo = Effect.fn("Profiles.switch")(function* (
    actor: User,
    principal: Principal,
    userId: string,
    secret: string | undefined,
    clientAddress: string,
  ) {
    const viewer = yield* loadViewer(read, actor);
    if (viewer.kind !== "household") return yield* new Forbidden();
    const target = yield* findRow(userId);
    if (target.kind !== "household") return yield* new Forbidden();
    // A personal phone or tablet stays its owner's; only browsers and household devices switch.
    if (principal.deviceId !== undefined && !principal.household) return yield* new Forbidden();
    const lock = lockOf(actor, target);
    if (lock !== undefined) {
      if (secret === undefined || secret === "") {
        return yield* new ProfileLocked({ requires: lock });
      }
      const hash = lock === "pin" ? (target.pinHash ?? NO_PASSWORD) : target.passwordHash;
      yield* checkSecret(target, secret, hash, clientAddress);
    }
    if (principal.deviceId === undefined) {
      const issued = yield* auth.issue(target, undefined);
      yield* write.delete(sessions).where(eq(sessions.id, principal.sessionId)).pipe(Effect.orDie);
      yield* Effect.logInfo("Switched profile").pipe(Effect.annotateLogs({ profile: target.id }));
      return issued;
    }
    const deviceId = principal.deviceId;
    const device = yield* write
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .update(sessions)
            .set({ userId: target.id })
            .where(eq(sessions.id, principal.sessionId));
          const [updated] = yield* tx
            .update(devices)
            .set({ userId: target.id })
            .where(eq(devices.id, deviceId))
            .returning();
          return updated;
        }),
      )
      .pipe(Effect.orDie);
    if (device === undefined) return yield* new Forbidden();
    yield* Effect.logInfo("Household device switched profile").pipe(
      Effect.annotateLogs({ profile: target.id, deviceId }),
    );
    return {
      result: {
        user: actingUser(target, true),
        device: toDevice(device),
        expiresAt: toInstant(principal.expiresAt),
      },
    } satisfies IssuedSession;
  });

  return { list, me, create, update, remove, setPin, verifyPin, switchTo };
});

/** Household profiles and accounts, PINs and profile switching. */
export class Profiles extends Context.Service<Profiles, Effect.Success<typeof makeProfiles>>()(
  "@slipstream/server/Profiles",
) {
  static readonly layer = Layer.effect(Profiles, makeProfiles);
}
