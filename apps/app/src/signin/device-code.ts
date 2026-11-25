import type {
  DeviceCodeGrant,
  DeviceCodeNotReady,
  DeviceInfo,
  LoginResult,
  RateLimited,
  SetupRequired,
} from "@slipstream/api";
import { Clock, Context, Data, DateTime, Duration, Effect, Layer, Schedule, Schema } from "effect";
import { HttpClientError } from "effect/http";
import { Api } from "../api/client.ts";

/** A device code as the TV shows it, with times as epoch ms. */
export interface ShownCode {
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: number;
}

/** What the sign-in screen shows while the device-code flow runs. */
export type DeviceCodeView =
  | { readonly _tag: "Requesting" }
  | { readonly _tag: "Showing"; readonly code: ShownCode }
  | { readonly _tag: "Approved"; readonly result: LoginResult };

/** The two auth endpoints the device-code flow needs, so tests can fake just those. */
export interface DeviceCodeEndpoints {
  readonly startDeviceCode: (request: {
    readonly payload: DeviceInfo;
  }) => Effect.Effect<
    DeviceCodeGrant,
    RateLimited | SetupRequired | HttpClientError.HttpClientError | Schema.SchemaError
  >;
  readonly pollDeviceCode: (request: {
    readonly payload: { readonly deviceCode: string };
  }) => Effect.Effect<
    LoginResult,
    DeviceCodeNotReady | HttpClientError.HttpClientError | Schema.SchemaError
  >;
}

/** {@link DeviceCodeEndpoints} as a service, provided from the API client. */
export class DeviceCodeAuth extends Context.Service<DeviceCodeAuth, DeviceCodeEndpoints>()(
  "@slipstream/app/DeviceCodeAuth",
) {
  /** The endpoints from the API client. */
  static readonly layer: Layer.Layer<DeviceCodeAuth, never, Api> = Layer.effect(
    DeviceCodeAuth,
    Effect.map(Api, (api) => ({
      startDeviceCode: (request) => api.auth.startDeviceCode(request),
      pollDeviceCode: (request) => api.auth.pollDeviceCode(request),
    })),
  );
}

/** Someone pressed "This isn't my TV" on the phone. */
export class SignInDenied extends Data.TaggedError("SignInDenied") {}

/** The server has no admin account yet, so nobody can approve a TV. */
export class ServerNotSetUp extends Data.TaggedError("ServerNotSetUp") {}

/** How the server answered one poll, as the loop reads it. */
export type PollOutcome =
  | { readonly _tag: "Approved"; readonly result: LoginResult }
  | { readonly _tag: "Pending" }
  | { readonly _tag: "SlowDown" }
  | { readonly _tag: "Expired" }
  | { readonly _tag: "Denied" };

/** RFC 8628: after `slow_down`, wait five seconds longer between polls from then on. */
export const SLOW_DOWN_STEP_MS = 5000;

/** The next poll interval and whether to keep polling this code, a fresh code, or stop. */
export const afterPoll = (
  outcome: PollOutcome,
  intervalMs: number,
): { readonly next: "poll" | "newCode" | "done" | "denied"; readonly intervalMs: number } => {
  switch (outcome._tag) {
    case "Approved":
      return { next: "done", intervalMs };
    case "Pending":
      return { next: "poll", intervalMs };
    case "SlowDown":
      return { next: "poll", intervalMs: intervalMs + SLOW_DOWN_STEP_MS };
    case "Expired":
      return { next: "newCode", intervalMs };
    case "Denied":
      return { next: "denied", intervalMs };
  }
};

/** Whole seconds until the code expires, never negative. */
export const secondsLeft = (code: ShownCode, now: number): number =>
  Math.max(0, Math.ceil((code.expiresAt - now) / 1000));

const shown = (grant: DeviceCodeGrant): ShownCode => ({
  userCode: grant.userCode,
  verificationUrl: grant.verificationUrl,
  expiresAt: DateTime.toEpochMillis(grant.expiresAt),
});

/** Network hiccups are retried with backoff; a TV may sit on this screen for a long time. */
const transient = {
  schedule: Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("15 seconds")]),
  while: (error: unknown) => HttpClientError.isHttpClientError(error),
};

/**
 * The whole device-code sign-in (PLAN 6.9): asks for a code, reports it to the screen, polls
 * at the server's interval until a phone approves, slows down when asked, and fetches a new
 * code by itself when one expires. Succeeds with the login result (user and device token).
 */
export const deviceCodeSignIn = (
  device: DeviceInfo,
  report: (view: DeviceCodeView) => void,
): Effect.Effect<LoginResult, SignInDenied | ServerNotSetUp, DeviceCodeAuth> =>
  Effect.gen(function* () {
    const auth = yield* DeviceCodeAuth;
    const poll = (deviceCode: string): Effect.Effect<PollOutcome> =>
      auth.pollDeviceCode({ payload: { deviceCode } }).pipe(
        Effect.map((result): PollOutcome => ({ _tag: "Approved", result })),
        Effect.catchTag("DeviceCodeNotReady", (error) =>
          Effect.succeed<PollOutcome>(
            error.reason === "pending"
              ? { _tag: "Pending" }
              : error.reason === "slowDown"
                ? { _tag: "SlowDown" }
                : error.reason === "expired"
                  ? { _tag: "Expired" }
                  : { _tag: "Denied" },
          ),
        ),
        Effect.retry(transient),
        // Anything else (a broken response) counts as "not yet" and is asked again.
        Effect.orElseSucceed((): PollOutcome => ({ _tag: "Pending" })),
      );
    const start = auth.startDeviceCode({ payload: device }).pipe(
      Effect.catchTag("RateLimited", (error) =>
        Effect.sleep(Duration.seconds(error.retryAfterSeconds)).pipe(
          Effect.andThen(Effect.fail(error)),
        ),
      ),
      Effect.retry({
        schedule: transient.schedule,
        while: (error) => error._tag === "RateLimited" || transient.while(error),
      }),
      Effect.catch((error) =>
        error._tag === "SetupRequired" ? Effect.fail(new ServerNotSetUp()) : Effect.die(error),
      ),
    );
    for (;;) {
      report({ _tag: "Requesting" });
      const grant = yield* start;
      const code = shown(grant);
      report({ _tag: "Showing", code });
      let intervalMs = Math.max(1, grant.intervalSeconds) * 1000;
      for (;;) {
        yield* Effect.sleep(Duration.millis(intervalMs));
        if ((yield* Clock.currentTimeMillis) >= code.expiresAt) break;
        const outcome = yield* poll(grant.deviceCode);
        const step = afterPoll(outcome, intervalMs);
        intervalMs = step.intervalMs;
        if (outcome._tag === "Approved") {
          report({ _tag: "Approved", result: outcome.result });
          return outcome.result;
        }
        if (step.next === "denied") return yield* Effect.fail(new SignInDenied());
        if (step.next === "newCode") break;
      }
    }
  });
