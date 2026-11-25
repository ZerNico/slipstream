import { DateTime, Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { type Guest, InviteInvalid, inviteUrl, SlipstreamApi } from "@slipstream/api";
import {
  epochMs,
  type GuestInvite,
  InviteId,
  inviteLifetimeMillis,
  type User,
  UserId,
} from "@slipstream/domain";
import { conflict, type MockContext, notFound, now, requireAdmin } from "./context.ts";
import { type HouseholdState, profileOf } from "./household.ts";

const guestOf = (state: HouseholdState, user: User): Guest => {
  const seen = state.lastSeen.get(user.id);
  return {
    ...profileOf(state, user),
    ...(seen === undefined
      ? {}
      : { lastSeenAt: DateTime.makeUnsafe(seen.at), lastSeenFrom: seen.from }),
  };
};

const expired = (invite: GuestInvite) =>
  invite.expiresAt !== undefined && epochMs(invite.expiresAt) <= Date.now();

/** The mock's `guests` group (SPEC 7.8): guests and their pending invites, admins only. */
export const guestsGroup = (ctx: MockContext) => {
  const { data, userById } = ctx;
  const state = data.household;
  return HttpApiBuilder.group(SlipstreamApi, "guests", (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          yield* requireAdmin;
          return data.users
            .filter((user) => state.guests.has(user.id))
            .map((user) => guestOf(state, user));
        }),
      )
      .handle("invites", () =>
        Effect.gen(function* () {
          yield* requireAdmin;
          return state.invites
            .filter((entry) => !entry.used && !expired(entry.invite))
            .map((entry) => entry.invite);
        }),
      )
      .handle("invite", ({ payload }) =>
        Effect.gen(function* () {
          const me = yield* requireAdmin;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const origin = `http://${request.headers.host ?? "localhost"}`;
          const token = crypto.randomUUID();
          const lifetime = inviteLifetimeMillis(payload.expiry);
          const invite: GuestInvite = {
            id: InviteId.make(crypto.randomUUID()),
            name: payload.name,
            access: payload.access,
            createdBy: me.id,
            createdAt: now(),
            ...(lifetime === undefined
              ? {}
              : { expiresAt: DateTime.makeUnsafe(Date.now() + lifetime) }),
            url: inviteUrl(origin, token),
          };
          state.invites = [...state.invites, { invite, token, used: false }];
          return invite;
        }),
      )
      .handle("revokeInvite", ({ params }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const entry = state.invites.find((item) => item.invite.id === params.inviteId);
          if (entry === undefined) return yield* notFound("invite", params.inviteId);
          state.invites = state.invites.filter((item) => item !== entry);
          state.spent.set(entry.token, "revoked");
        }),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const found = userById(params.userId);
          if (found === undefined || !state.guests.has(found.id)) {
            return yield* notFound("user", params.userId);
          }
          const updated: User = {
            ...found,
            ...(payload.displayName === undefined ? {} : { displayName: payload.displayName }),
          };
          data.users = data.users.map((user) => (user.id === found.id ? updated : user));
          if (payload.access !== undefined) state.access.set(found.id, payload.access);
          return guestOf(state, updated);
        }),
      ),
  );
};

/** The mock's public `invites` group: the invite page looks a token up and accepts it. */
export const invitesGroup = (ctx: MockContext) => {
  const { data, passwords, signIn, userById } = ctx;
  const state = data.household;
  const valid = (token: string) =>
    Effect.gen(function* () {
      const spent = state.spent.get(token);
      if (spent !== undefined) return yield* Effect.fail(new InviteInvalid({ reason: spent }));
      const entry = state.invites.find((item) => item.token === token);
      if (entry === undefined) return yield* notFound("invite", "token");
      if (entry.used) return yield* Effect.fail(new InviteInvalid({ reason: "used" }));
      if (expired(entry.invite)) {
        return yield* Effect.fail(new InviteInvalid({ reason: "expired" }));
      }
      return entry;
    });

  return HttpApiBuilder.group(SlipstreamApi, "invites", (handlers) =>
    handlers
      .handle("lookup", ({ payload }) =>
        Effect.gen(function* () {
          const { invite } = yield* valid(payload.token);
          return {
            name: invite.name,
            invitedBy: userById(invite.createdBy)?.displayName ?? invite.name,
            access: invite.access,
            ...(invite.expiresAt === undefined ? {} : { expiresAt: invite.expiresAt }),
          };
        }),
      )
      .handle("accept", ({ payload }) =>
        Effect.gen(function* () {
          const entry = yield* valid(payload.token);
          if (data.users.some((user) => user.username === payload.username)) {
            return yield* conflict("usernameTaken");
          }
          const guest: User = {
            id: UserId.make(crypto.randomUUID()),
            username: payload.username,
            displayName: payload.displayName ?? entry.invite.name,
            role: "user",
            createdAt: now(),
          };
          data.users = [...data.users, guest];
          passwords.set(guest.id, payload.password);
          state.guests.add(guest.id);
          state.access.set(guest.id, entry.invite.access);
          state.tones.set(guest.id, "rose");
          entry.used = true;
          state.invites = state.invites.filter((item) => item !== entry);
          state.spent.set(entry.token, "used");
          // Whoever was signed in on this mock browser is now the guest.
          if (ctx.autoUser !== undefined) ctx.autoUser = guest.id;
          return yield* signIn(guest);
        }),
      ),
  );
};
