import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  AlreadySetUp,
  CurrentUser,
  DeviceCodeNotReady,
  Forbidden,
  InvalidCredentials,
  normaliseUserCode,
  SlipstreamApi,
} from "@slipstream/api";
import { DeviceId, epochMs, type User, UserId } from "@slipstream/domain";
import { type MockContext, notFound, notInMock, now } from "./context.ts";

/**
 * The mock's `auth` group: setup, sign-in and out, TV device codes, household profiles.
 * The shared state is in context.ts.
 */
export const authGroup = (ctx: MockContext) => {
  const { data, sessions, passwords, userById, passwordOf, signIn } = ctx;
  const findPending = (userCode: string) =>
    Effect.gen(function* () {
      const code = normaliseUserCode(userCode);
      const pending = data.pendingSignIns.find((item) => item.userCode === code);
      if (pending === undefined) return yield* notFound("device", userCode);
      if (epochMs(pending.expiresAt) <= Date.now()) {
        return yield* Effect.fail(new DeviceCodeNotReady({ reason: "expired" }));
      }
      return pending;
    });

  return HttpApiBuilder.group(SlipstreamApi, "auth", (handlers) =>
    handlers
      .handle("setupStatus", () => Effect.sync(() => ({ required: data.users.length === 0 })))
      .handle("setup", ({ payload }) =>
        Effect.gen(function* () {
          if (data.users.length > 0) return yield* Effect.fail(new AlreadySetUp());
          const admin: User = {
            id: UserId.make(payload.username),
            username: payload.username,
            displayName: payload.displayName,
            role: "admin",
            createdAt: now(),
          };
          data.users = [admin];
          passwords.set(admin.id, payload.password);
          return yield* signIn(admin);
        }),
      )
      .handle("login", ({ payload }) =>
        Effect.gen(function* () {
          const user = data.users.find((candidate) => candidate.username === payload.username);
          if (user === undefined || payload.password !== passwordOf(user.id)) {
            return yield* Effect.fail(new InvalidCredentials());
          }
          return yield* signIn(user);
        }),
      )
      // The TV side of device sign-in is the app's; the web only approves codes.
      .handle("startDeviceCode", () => notInMock)
      .handle("pollDeviceCode", () => notInMock)
      .handle("pendingDeviceCode", ({ params }) => findPending(params.userCode))
      .handle("approveDeviceCode", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const pending = yield* findPending(payload.userCode);
          const signInAs = payload.userId ?? user.id;
          if (signInAs !== user.id && user.role !== "admin") {
            return yield* Effect.fail(new Forbidden());
          }
          if (userById(signInAs) === undefined) return yield* notFound("user", signInAs);
          data.pendingSignIns = data.pendingSignIns.filter((item) => item !== pending);
          // Blocking is a success for the person on the phone; the TV hears "denied" on its poll.
          if (!payload.approve) return { device: pending.device };
          data.devices = [
            ...data.devices,
            {
              id: DeviceId.make(crypto.randomUUID()),
              userId: signInAs,
              name: pending.device.name,
              kind: pending.device.kind,
              createdAt: now(),
            },
          ];
          return { device: pending.device, userId: signInAs };
        }),
      )
      .handle("logout", () =>
        Effect.sync(() => {
          // Sign everyone out: the mock serves one browser at a time.
          sessions.clear();
          ctx.autoUser = undefined;
        }),
      )
      .handle("me", () =>
        Effect.gen(function* () {
          return yield* CurrentUser;
        }),
      ),
  );
};
