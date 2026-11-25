import {
  DeviceCodeNotReady,
  LoginResult,
  RateLimited,
  type DeviceCodeGrant,
} from "@slipstream/api";
import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  afterPoll,
  DeviceCodeAuth,
  deviceCodeSignIn,
  type DeviceCodeEndpoints,
  secondsLeft,
  SLOW_DOWN_STEP_MS,
  type DeviceCodeView,
} from "./device-code.ts";

const loginResult = Schema.decodeUnknownSync(LoginResult)({
  user: {
    id: "u1",
    username: "alex",
    displayName: "Alex",
    role: "admin",
    createdAt: "2026-11-01T00:00:00.000Z",
  },
  token: "device-token",
  expiresAt: "2027-11-01T00:00:00.000Z",
});

type Reply = "pending" | "slowDown" | "expired" | "denied" | "approved";

/**
 * A fake auth API: each started code expires after `lifetimeSeconds`; polls answer from
 * `replies` in order (the last one repeats). Records when each call happened.
 */
const fakeAuth = (
  replies: readonly Reply[],
  lifetimeSeconds = 600,
  startFailures: RateLimited[] = [],
) => {
  const calls: { kind: "start" | "poll"; at: number; deviceCode?: string }[] = [];
  let codes = 0;
  let polls = 0;
  const auth: DeviceCodeEndpoints = {
    startDeviceCode: () =>
      Effect.gen(function* () {
        const at = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        calls.push({ kind: "start", at });
        const failure = startFailures.shift();
        if (failure !== undefined) return yield* Effect.fail(failure);
        codes += 1;
        const grant: DeviceCodeGrant = {
          deviceCode: `dc${codes}`,
          userCode: `QK74R${codes}`,
          verificationUrl: "http://tv.local/link",
          expiresAt: DateTime.makeUnsafe(at + lifetimeSeconds * 1000),
          intervalSeconds: 5,
        };
        return grant;
      }),
    pollDeviceCode: ({ payload }) =>
      Effect.gen(function* () {
        const at = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        calls.push({ kind: "poll", at, deviceCode: payload.deviceCode });
        const reply = replies[Math.min(polls, replies.length - 1)] ?? "pending";
        polls += 1;
        if (reply === "approved") return loginResult;
        return yield* Effect.fail(new DeviceCodeNotReady({ reason: reply }));
      }),
  };
  const layer = Layer.succeed(DeviceCodeAuth, auth);
  return { calls, layer };
};

const device = { name: "Living Room Shield", kind: "tv" } as const;

describe("deviceCodeSignIn", () => {
  it.effect("shows the code, polls at the interval and returns the token on approval", () =>
    Effect.gen(function* () {
      const fake = fakeAuth(["pending", "pending", "approved"]);
      const views: DeviceCodeView[] = [];
      const fiber = yield* deviceCodeSignIn(device, (view) => views.push(view)).pipe(
        Effect.provide(fake.layer),
        Effect.forkChild,
      );
      yield* TestClock.adjust("15 seconds");
      const result = yield* Fiber.join(fiber);
      expect(result.token).toBe("device-token");
      expect(fake.calls.map((call) => [call.kind, call.at])).toEqual([
        ["start", 0],
        ["poll", 5000],
        ["poll", 10000],
        ["poll", 15000],
      ]);
      expect(views.map((view) => view._tag)).toEqual(["Requesting", "Showing", "Approved"]);
      const showing = views[1];
      expect(showing?._tag === "Showing" && showing.code.userCode).toBe("QK74R1");
    }),
  );

  it.effect("waits five seconds longer after slow down", () =>
    Effect.gen(function* () {
      const fake = fakeAuth(["slowDown", "pending", "approved"]);
      const fiber = yield* deviceCodeSignIn(device, () => undefined).pipe(
        Effect.provide(fake.layer),
        Effect.forkChild,
      );
      yield* TestClock.adjust("30 seconds");
      yield* Fiber.join(fiber);
      expect(fake.calls.filter((call) => call.kind === "poll").map((call) => call.at)).toEqual([
        5000, 15000, 25000,
      ]);
    }),
  );

  it.effect("fetches a new code when the old one expires", () =>
    Effect.gen(function* () {
      const fake = fakeAuth(["pending", "expired", "approved"], 12);
      const fiber = yield* deviceCodeSignIn(device, () => undefined).pipe(
        Effect.provide(fake.layer),
        Effect.forkChild,
      );
      yield* TestClock.adjust("40 seconds");
      yield* Fiber.join(fiber);
      const starts = fake.calls.filter((call) => call.kind === "start");
      expect(starts.length).toBe(2);
      // The first code expires after 12 s: polls at 5 s and 10 s, then a new code at 15 s.
      expect(fake.calls.map((call) => call.deviceCode ?? call.kind)).toEqual([
        "start",
        "dc1",
        "dc1",
        "start",
        "dc2",
      ]);
    }),
  );

  it.effect("stops when the phone blocks the sign-in", () =>
    Effect.gen(function* () {
      const fake = fakeAuth(["denied"]);
      const fiber = yield* deviceCodeSignIn(device, () => undefined).pipe(
        Effect.provide(fake.layer),
        Effect.forkChild,
      );
      yield* TestClock.adjust("5 seconds");
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(JSON.stringify(exit)).toContain("SignInDenied");
    }),
  );

  it.effect("waits out a rate limit before asking for a code again", () =>
    Effect.gen(function* () {
      const fake = fakeAuth(["approved"], 600, [new RateLimited({ retryAfterSeconds: 20 })]);
      const fiber = yield* deviceCodeSignIn(device, () => undefined).pipe(
        Effect.provide(fake.layer),
        Effect.forkChild,
      );
      yield* TestClock.adjust("40 seconds");
      yield* Fiber.join(fiber);
      const starts = fake.calls.filter((call) => call.kind === "start").map((call) => call.at);
      expect(starts[0]).toBe(0);
      expect(starts[1]).toBeGreaterThanOrEqual(20_000);
    }),
  );
});

describe("afterPoll", () => {
  it("keeps polling, slows down, renews or stops", () => {
    expect(afterPoll({ _tag: "Pending" }, 5000)).toEqual({ next: "poll", intervalMs: 5000 });
    expect(afterPoll({ _tag: "SlowDown" }, 5000)).toEqual({
      next: "poll",
      intervalMs: 5000 + SLOW_DOWN_STEP_MS,
    });
    expect(afterPoll({ _tag: "Expired" }, 5000).next).toBe("newCode");
    expect(afterPoll({ _tag: "Denied" }, 5000).next).toBe("denied");
  });
});

describe("secondsLeft", () => {
  it("rounds up and stops at zero", () => {
    const code = { userCode: "X", verificationUrl: "", expiresAt: 10_500 };
    expect(secondsLeft(code, 0)).toBe(11);
    expect(secondsLeft(code, 20_000)).toBe(0);
  });
});
