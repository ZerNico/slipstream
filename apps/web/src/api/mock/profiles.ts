import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  CurrentUser,
  Forbidden,
  InvalidCredentials,
  InvalidInput,
  ProfileLocked,
  RateLimited,
  SlipstreamApi,
} from "@slipstream/api";
import { fullAccess, type User, UserId } from "@slipstream/domain";
import { conflict, type MockContext, notFound, notInMock, now, requireAdmin } from "./context.ts";
import { profileOf } from "./household.ts";

/** Wrong PINs and passwords in a row before the mock answers RateLimited, like the server. */
const attemptsBeforeLimit = 5;

/**
 * The mock's `profiles` group (SPEC 7.8): household profiles and accounts, PINs and switching.
 * A guest sees only itself and can neither switch nor be switched to.
 */
export const profilesGroup = (ctx: MockContext) => {
  const { data, sessions, passwords, userById, passwordOf, signIn } = ctx;
  const state = data.household;
  let failures = 0;
  const adminCount = () => data.users.filter((user) => user.role === "admin").length;
  const guard = (ok: boolean) =>
    Effect.gen(function* () {
      if (failures >= attemptsBeforeLimit) {
        return yield* Effect.fail(new RateLimited({ retryAfterSeconds: 60 }));
      }
      if (ok) {
        failures = 0;
        return;
      }
      failures += 1;
      return yield* Effect.fail(new InvalidCredentials());
    });
  const findUser = (id: UserId) =>
    Effect.suspend(() => {
      const user = userById(id);
      return user === undefined ? notFound("user", id) : Effect.succeed(user);
    });

  return HttpApiBuilder.group(SlipstreamApi, "profiles", (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const me = yield* CurrentUser;
          if (state.guests.has(me.id)) return [profileOf(state, me)];
          return data.users
            .filter((user) => !state.guests.has(user.id))
            .map((user) => profileOf(state, user));
        }),
      )
      .handle("me", () =>
        Effect.gen(function* () {
          const me = yield* CurrentUser;
          return profileOf(state, me);
        }),
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const username = payload.login?.username.trim().toLowerCase();
          if (username !== undefined && data.users.some((user) => user.username === username)) {
            return yield* conflict("usernameTaken");
          }
          const id = UserId.make(crypto.randomUUID());
          const created: User = {
            id,
            username: username ?? `profile-${id.slice(0, 8)}`,
            displayName: payload.displayName,
            role: payload.role ?? "user",
            createdAt: now(),
          };
          data.users = [...data.users, created];
          state.tones.set(id, payload.avatarTone);
          if (payload.pin !== undefined) state.pins.set(id, payload.pin);
          if (payload.login !== undefined) passwords.set(id, payload.login.password);
          state.access.set(id, payload.access ?? fullAccess);
          return profileOf(state, created);
        }),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const me = yield* CurrentUser;
          const found = yield* findUser(params.userId);
          const admin = me.role === "admin";
          const adminOnly = payload.role !== undefined || payload.access !== undefined;
          if (!admin && (found.id !== me.id || adminOnly)) {
            return yield* Effect.fail(new Forbidden());
          }
          if (payload.role === "admin" && state.guests.has(found.id)) {
            return yield* Effect.fail(new Forbidden());
          }
          // Your own password needs the current one; admins reset other people's without it.
          if (payload.password !== undefined && found.id === me.id) {
            if (payload.currentPassword !== passwordOf(me.id)) {
              const code = payload.currentPassword === undefined ? "required" : "incorrect";
              return yield* Effect.fail(
                new InvalidInput({ problems: [{ path: "currentPassword", code }] }),
              );
            }
          }
          if (payload.role === "user" && found.role === "admin" && adminCount() === 1) {
            return yield* conflict("lastAdmin");
          }
          const updated: User = {
            ...found,
            ...(payload.displayName === undefined ? {} : { displayName: payload.displayName }),
            ...(payload.role === undefined ? {} : { role: payload.role }),
          };
          data.users = data.users.map((user) => (user.id === found.id ? updated : user));
          if (payload.avatarTone !== undefined) state.tones.set(found.id, payload.avatarTone);
          if (payload.access !== undefined) state.access.set(found.id, payload.access);
          if (payload.password !== undefined) passwords.set(found.id, payload.password);
          return profileOf(state, updated);
        }),
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const me = yield* requireAdmin;
          const found = yield* findUser(params.userId);
          if (found.id === me.id) return yield* conflict("deleteSelf");
          if (found.role === "admin" && adminCount() === 1) return yield* conflict("lastAdmin");
          data.users = data.users.filter((user) => user.id !== found.id);
          // Deleting an account signs out its devices and sessions.
          data.devices = data.devices.filter((device) => device.userId !== found.id);
          for (const [token, session] of sessions) {
            if (session.userId === found.id) sessions.delete(token);
          }
        }),
      )
      .handle("setPin", ({ params, payload }) =>
        Effect.gen(function* () {
          const me = yield* CurrentUser;
          const found = yield* findUser(params.userId);
          const self = found.id === me.id;
          if (me.role !== "admin" && !self) return yield* Effect.fail(new Forbidden());
          const current = state.pins.get(found.id);
          // Admins reset other people's PINs; their own needs the current one like anyone's.
          if (self && current !== undefined) yield* guard(payload.currentPin === current);
          if (payload.pin === null) state.pins.delete(found.id);
          else state.pins.set(found.id, payload.pin);
        }),
      )
      .handle("verifyPin", () => notInMock)
      .handle("switch", ({ params, payload }) =>
        Effect.gen(function* () {
          const me = yield* CurrentUser;
          const target = yield* findUser(params.userId);
          if (state.guests.has(me.id) || state.guests.has(target.id)) {
            return yield* Effect.fail(new Forbidden());
          }
          const pin = state.pins.get(target.id);
          if (target.id !== me.id && pin !== undefined) {
            if (payload.secret === undefined) {
              return yield* Effect.fail(new ProfileLocked({ requires: "pin" }));
            }
            yield* guard(payload.secret === pin);
          } else if (target.id !== me.id && target.role === "admin") {
            if (payload.secret === undefined) {
              return yield* Effect.fail(new ProfileLocked({ requires: "password" }));
            }
            yield* guard(payload.secret === passwordOf(target.id));
          }
          // The dev mock treats cookie-less requests as one person; that person is now `target`.
          if (ctx.autoUser !== undefined) ctx.autoUser = target.id;
          return yield* signIn(target);
        }),
      ),
  );
};
