/**
 * Guests (SPEC 7.8): friends with their own account who sign in from anywhere, invited by link,
 * with an access policy. Admins invite, list, change and (through `profiles.remove`) delete them.
 *
 * An invite link carries a random 256-bit token. The database keeps its SHA-256 for lookups and
 * a sealed copy (the source-secret box) so admins can copy the link again until it is used.
 * Looking up and accepting count against the sign-in rate limit, so tokens cannot be guessed.
 */
import { and, asc, eq, isNull, or, gt } from "drizzle-orm";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import {
  Conflict,
  InvalidInput,
  InviteInvalid,
  NotFound,
  inviteUrl,
  type Guest,
  type GuestInviteInput,
  type GuestUpdate,
  type InviteAcceptance,
  type InvitePreview,
} from "@slipstream/api";
import {
  type GuestInvite,
  InviteId,
  inviteLifetimeMillis,
  type User,
  UserId,
} from "@slipstream/domain";
import { hashPassword, randomToken, sha256 } from "../auth/crypto.ts";
import { RateLimiter } from "../auth/rate-limit.ts";
import { Auth, LOGIN_PER_CLIENT, normaliseUsername, requireAdmin } from "../auth/service.ts";
import { linkOrigin, ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { opt, toInstant } from "../db/codec.ts";
import { invites, users } from "../db/schema.ts";
import { newId } from "../ids.ts";
import { EventBus } from "../events.ts";
import { accessProblems, toProfile } from "../profiles/service.ts";
import { SecretBox } from "../sources/secret-box.ts";

type InviteRow = typeof invites.$inferSelect;
type UserRow = typeof users.$inferSelect;

/** A guest row as admins see it. */
const toGuest = (row: UserRow): Guest => ({
  ...toProfile(row),
  ...opt("lastSeenAt", row.lastSeenAt === null ? null : toInstant(row.lastSeenAt)),
  ...opt("lastSeenFrom", row.lastSeenFrom),
});

/** Why an invite row can no longer be used at `now`, if it cannot. */
export const inviteProblem = (
  row: Pick<InviteRow, "usedAt" | "revokedAt" | "expiresAt">,
  now: number,
): "used" | "revoked" | "expired" | undefined =>
  row.usedAt !== null
    ? "used"
    : row.revokedAt !== null
      ? "revoked"
      : row.expiresAt !== null && row.expiresAt <= now
        ? "expired"
        : undefined;

const makeGuests = Effect.gen(function* () {
  const { write, read } = yield* Db;
  const auth = yield* Auth;
  const box = yield* SecretBox;
  const limiter = yield* RateLimiter;
  const config = yield* ServerConfig;
  const bus = yield* EventBus;

  const origin = () => linkOrigin(config);

  const toInvite = (row: InviteRow) =>
    Effect.map(box.open(row.sealedToken), (token) => {
      const decoded = Schema.decodeUnknownSync(Schema.String)(token);
      return {
        id: InviteId.make(row.id),
        name: row.name,
        access: row.access,
        createdBy: UserId.make(row.createdBy),
        createdAt: toInstant(row.createdAt),
        ...opt("expiresAt", row.expiresAt === null ? null : toInstant(row.expiresAt)),
        url: inviteUrl(origin(), decoded),
      } satisfies GuestInvite;
    });

  const guestRow = (userId: string) =>
    Effect.gen(function* () {
      const [row] = yield* read
        .select()
        .from(users)
        .where(and(eq(users.id, userId), eq(users.kind, "guest")))
        .pipe(Effect.orDie);
      if (row === undefined) return yield* new NotFound({ entity: "user", id: userId });
      return row;
    });

  const list = (actor: User) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      const rows = yield* read
        .select()
        .from(users)
        .where(eq(users.kind, "guest"))
        .orderBy(asc(users.createdAt))
        .pipe(Effect.orDie);
      return rows.map(toGuest);
    });

  /** Invites still waiting: not accepted, revoked or expired. */
  const pending = (actor: User) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      const now = yield* Clock.currentTimeMillis;
      const rows = yield* read
        .select()
        .from(invites)
        .where(
          and(
            isNull(invites.usedAt),
            isNull(invites.revokedAt),
            or(isNull(invites.expiresAt), gt(invites.expiresAt, now)),
          ),
        )
        .orderBy(asc(invites.createdAt))
        .pipe(Effect.orDie);
      return yield* Effect.forEach(rows, toInvite);
    });

  const invite = Effect.fn("Guests.invite")(function* (actor: User, input: GuestInviteInput) {
    yield* requireAdmin(actor);
    const name = input.name.trim();
    const problems = [
      ...(name === "" ? [{ path: "name", code: "required" }] : []),
      ...(yield* accessProblems(read, input.access)),
    ];
    if (problems.length > 0) return yield* new InvalidInput({ problems });
    const now = yield* Clock.currentTimeMillis;
    const lifetime = inviteLifetimeMillis(input.expiry);
    const token = randomToken();
    const row: InviteRow = {
      id: newId(),
      tokenHash: sha256(token),
      sealedToken: box.seal(token),
      name,
      access: input.access,
      createdBy: actor.id,
      createdAt: now,
      expiresAt: lifetime === undefined ? null : now + lifetime,
      usedAt: null,
      revokedAt: null,
      acceptedBy: null,
    };
    yield* write.insert(invites).values(row).pipe(Effect.orDie);
    yield* Effect.logInfo("Guest invite created").pipe(Effect.annotateLogs({ invite: row.id }));
    return yield* toInvite(row);
  });

  const revoke = (actor: User, inviteId: string) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      const now = yield* Clock.currentTimeMillis;
      const revoked = yield* write
        .update(invites)
        .set({ revokedAt: now })
        .where(and(eq(invites.id, inviteId), isNull(invites.usedAt), isNull(invites.revokedAt)))
        .returning({ id: invites.id })
        .pipe(Effect.orDie);
      if (revoked.length === 0) return yield* new NotFound({ entity: "invite", id: inviteId });
    });

  const update = Effect.fn("Guests.update")(function* (
    actor: User,
    userId: string,
    patch: GuestUpdate,
  ) {
    yield* requireAdmin(actor);
    const row = yield* guestRow(userId);
    const displayName = patch.displayName?.trim();
    const problems = [
      ...(displayName === "" ? [{ path: "displayName", code: "required" }] : []),
      ...(patch.access === undefined ? [] : yield* accessProblems(read, patch.access)),
    ];
    if (problems.length > 0) return yield* new InvalidInput({ problems });
    const changes = {
      ...(displayName === undefined ? {} : { displayName }),
      ...(patch.access === undefined ? {} : { access: patch.access }),
    };
    if (Object.keys(changes).length > 0) {
      yield* write.update(users).set(changes).where(eq(users.id, userId)).pipe(Effect.orDie);
      // New access changes what the guest may see, and so their guide repeats.
      if (patch.access !== undefined) yield* bus.publishHouseholdChanged;
    }
    return toGuest({ ...row, ...changes });
  });

  /**
   * The invite behind a token, or why it cannot be used. Unknown tokens count against the
   * client's sign-in limit, so links cannot be guessed.
   */
  const usable = (token: string, clientAddress: string) =>
    Effect.gen(function* () {
      const clientKey = `login:client:${clientAddress}`;
      yield* limiter.check(clientKey, LOGIN_PER_CLIENT);
      const [row] = yield* read
        .select()
        .from(invites)
        .where(eq(invites.tokenHash, sha256(token)))
        .pipe(Effect.orDie);
      if (row === undefined) {
        yield* limiter.hit(clientKey, LOGIN_PER_CLIENT);
        return yield* new NotFound({ entity: "invite", id: "token" });
      }
      const problem = inviteProblem(row, yield* Clock.currentTimeMillis);
      if (problem !== undefined) return yield* new InviteInvalid({ reason: problem });
      return row;
    });

  const lookup = (token: string, clientAddress: string) =>
    Effect.gen(function* () {
      const row = yield* usable(token, clientAddress);
      const [inviter] = yield* read
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, row.createdBy))
        .pipe(Effect.orDie);
      return {
        name: row.name,
        invitedBy: inviter?.displayName ?? row.name,
        ...opt("expiresAt", row.expiresAt === null ? null : toInstant(row.expiresAt)),
        access: row.access,
      } satisfies InvitePreview;
    });

  const accept = Effect.fn("Guests.accept")(function* (
    input: InviteAcceptance,
    clientAddress: string,
  ) {
    const row = yield* usable(input.token, clientAddress);
    const username = normaliseUsername(input.username);
    const displayName = (input.displayName ?? row.name).trim();
    const problems = [
      ...(username === "" ? [{ path: "username", code: "required" }] : []),
      ...(displayName === "" ? [{ path: "displayName", code: "required" }] : []),
    ];
    if (problems.length > 0) return yield* new InvalidInput({ problems });
    const passwordHash = yield* hashPassword(input.password);
    const now = yield* Clock.currentTimeMillis;
    const guest: UserRow = {
      id: newId(),
      username,
      displayName,
      role: "user",
      passwordHash,
      createdAt: now,
      kind: "guest",
      avatarTone: "teal",
      pinHash: null,
      access: row.access,
      lastSeenAt: null,
      lastSeenFrom: null,
    };
    // One transaction: the invite is used exactly once, even when two people race for it.
    const outcome = yield* write
      .transaction((tx) =>
        Effect.gen(function* () {
          const [taken] = yield* tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.username, username));
          if (taken !== undefined) return "usernameTaken" as const;
          const claimed = yield* tx
            .update(invites)
            .set({ usedAt: now })
            .where(and(eq(invites.id, row.id), isNull(invites.usedAt), isNull(invites.revokedAt)))
            .returning({ id: invites.id });
          if (claimed.length === 0) return "used" as const;
          yield* tx.insert(users).values(guest);
          yield* tx.update(invites).set({ acceptedBy: guest.id }).where(eq(invites.id, row.id));
          return "created" as const;
        }),
      )
      .pipe(Effect.orDie);
    if (outcome === "usernameTaken") return yield* new Conflict({ code: "usernameTaken" });
    if (outcome === "used") return yield* new InviteInvalid({ reason: "used" });
    yield* Effect.logInfo("Guest accepted an invite").pipe(
      Effect.annotateLogs({ invite: row.id, guest: guest.id }),
    );
    return yield* auth.issue(guest, input.device);
  });

  return { list, pending, invite, revoke, update, lookup, accept };
});

/** Guests and their invites. */
export class Guests extends Context.Service<Guests, Effect.Success<typeof makeGuests>>()(
  "@slipstream/server/Guests",
) {
  static readonly layer = Layer.effect(Guests, makeGuests);
}
