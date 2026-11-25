/**
 * In-memory rate limiting for sign-in attempts: fixed windows (per client address, per PIN) and
 * an exponential backoff per username, which slows password guessing down more with every wrong
 * guess without ever locking the account. State is per process and lost on restart, which is
 * fine for slowing down password guessing against a household server.
 *
 * Checking a secret takes a whole scrypt derivation, during which other requests run. A check
 * that only counts after the derivation would let a burst of concurrent guesses through before
 * the first one is counted, so secrets are checked under a `reserve`: every key is checked and
 * counted in one step, before the derivation starts, and a right secret gives the count back.
 */
import { Clock, Context, Effect, Layer } from "effect";
import { RateLimited } from "@slipstream/api";

interface Window {
  readonly startedAt: number;
  readonly count: number;
  /** The window length it was counted under, so pruning needs no limit at hand. */
  readonly windowMillis: number;
}

/** A limit: at most `max` events per `windowMillis`. */
export interface Limit {
  readonly max: number;
  readonly windowMillis: number;
}

/**
 * An exponential backoff: the first `free` failures cost nothing, then each one makes the next
 * attempt wait twice as long, from `baseMillis` up to `maxMillis`. A key with no failure for
 * `forgetMillis` starts over.
 */
export interface Backoff {
  readonly free: number;
  readonly baseMillis: number;
  readonly maxMillis: number;
  readonly forgetMillis: number;
}

/** One key a `reserve` checks and counts: a window, or a backoff. */
export type Claim =
  | { readonly key: string; readonly limit: Limit }
  | { readonly key: string; readonly backoff: Backoff };

interface Strikes {
  readonly failures: number;
  readonly lastAt: number;
  /** No attempt before this, epoch ms. */
  readonly nextAt: number;
  /** How long it is kept without a new failure, from the backoff it was counted under. */
  readonly forgetMillis: number;
}

/** The wait after `failures` failures under `backoff`, in milliseconds. */
export const backoffDelay = (backoff: Backoff, failures: number): number =>
  failures <= backoff.free
    ? 0
    : Math.min(backoff.maxMillis, backoff.baseMillis * 2 ** (failures - backoff.free - 1));

/** Fails with the refusal, if there is one. */
const refusal = (refused: RateLimited | undefined): Effect.Effect<void, RateLimited> =>
  refused === undefined ? Effect.void : Effect.fail(refused);

/** Keep the maps from growing without bound under a spray of distinct keys. */
const MAX_KEYS = 10_000;

/** Counts events per key and refuses keys that went over their limit. */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    /** Fails with `RateLimited` while `key` is over `limit`; does not count anything. */
    readonly check: (key: string, limit: Limit) => Effect.Effect<void, RateLimited>;
    /** Counts one event for `key` (a failed sign-in, a device-code request). */
    readonly hit: (key: string, limit: Limit) => Effect.Effect<void>;
    /** Checks, then counts: for requests that are limited whether or not they succeed. */
    readonly consume: (key: string, limit: Limit) => Effect.Effect<void, RateLimited>;
    /**
     * Checks every claim and, only if none refuses, counts every one, in one step that no other
     * request can interleave with: an attempt is counted before the work it guards (a password
     * or PIN derivation), so concurrent guesses cannot all pass the check first. A right secret
     * gives the counts back with `refund` and `reset`.
     */
    readonly reserve: (claims: ReadonlyArray<Claim>) => Effect.Effect<void, RateLimited>;
    /**
     * Takes one counted event of `key` back (a reserved attempt that turned out right). The
     * entry remembers the window it was counted in.
     */
    readonly refund: (key: string) => Effect.Effect<void>;
    /** Forgets `key` (its window and its backoff), e.g. after a successful sign-in. */
    readonly reset: (key: string) => Effect.Effect<void>;
  }
>()("@slipstream/server/RateLimiter") {
  static readonly layer = Layer.sync(RateLimiter, () => {
    const windows = new Map<string, Window>();
    const strikes = new Map<string, Strikes>();

    const strikesOf = (key: string, now: number): Strikes | undefined => {
      const entry = strikes.get(key);
      if (entry === undefined) return undefined;
      if (now - entry.lastAt >= entry.forgetMillis) {
        strikes.delete(key);
        return undefined;
      }
      return entry;
    };

    const current = (key: string, now: number): Window | undefined => {
      const window = windows.get(key);
      if (window === undefined) return undefined;
      if (now - window.startedAt >= window.windowMillis) {
        windows.delete(key);
        return undefined;
      }
      return window;
    };

    /** The refusal for `key` under `limit` at `now`, if it is over. */
    const refusalOf = (key: string, limit: Limit, now: number): RateLimited | undefined => {
      const window = current(key, now);
      if (window === undefined || window.count < limit.max) return undefined;
      return new RateLimited({
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((window.startedAt + window.windowMillis - now) / 1000),
        ),
      });
    };

    /** The refusal for `key` under `backoff` at `now`, while it still has to wait. */
    const waitingOf = (key: string, now: number): RateLimited | undefined => {
      const entry = strikesOf(key, now);
      if (entry === undefined || entry.nextAt <= now) return undefined;
      return new RateLimited({
        retryAfterSeconds: Math.max(1, Math.ceil((entry.nextAt - now) / 1000)),
      });
    };

    const count = (key: string, limit: Limit, now: number) => {
      const window = current(key, now);
      windows.set(
        key,
        window === undefined
          ? { startedAt: now, count: 1, windowMillis: limit.windowMillis }
          : { ...window, count: window.count + 1 },
      );
      // Each entry is pruned by its own window: keys of a short limit never outlive it because
      // a longer one happened to trigger the sweep.
      if (windows.size > MAX_KEYS) {
        for (const [candidate, value] of windows) {
          if (now - value.startedAt >= value.windowMillis) windows.delete(candidate);
        }
      }
    };

    const addStrike = (key: string, backoff: Backoff, now: number) => {
      const failures = (strikesOf(key, now)?.failures ?? 0) + 1;
      strikes.set(key, {
        failures,
        lastAt: now,
        nextAt: now + backoffDelay(backoff, failures),
        forgetMillis: backoff.forgetMillis,
      });
      if (strikes.size > MAX_KEYS) {
        for (const [candidate, value] of strikes) {
          if (now - value.lastAt >= value.forgetMillis) strikes.delete(candidate);
        }
      }
    };

    const check = (key: string, limit: Limit) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) => refusal(refusalOf(key, limit, now)));

    const hit = (key: string, limit: Limit) =>
      Effect.map(Clock.currentTimeMillis, (now) => count(key, limit, now));

    const reserve = (claims: ReadonlyArray<Claim>) =>
      // Everything after reading the clock runs synchronously, so no other fiber gets between
      // the checks and the counts.
      Effect.flatMap(Clock.currentTimeMillis, (now) => {
        for (const claim of claims) {
          const refused =
            "limit" in claim ? refusalOf(claim.key, claim.limit, now) : waitingOf(claim.key, now);
          if (refused !== undefined) return Effect.fail(refused);
        }
        for (const claim of claims) {
          if ("limit" in claim) count(claim.key, claim.limit, now);
          else addStrike(claim.key, claim.backoff, now);
        }
        return Effect.void;
      });

    const refund = (key: string) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const window = current(key, now);
        if (window === undefined) return;
        if (window.count <= 1) windows.delete(key);
        else windows.set(key, { ...window, count: window.count - 1 });
      });

    return {
      check,
      hit,
      consume: (key, limit) => reserve([{ key, limit }]),
      reserve,
      refund,
      reset: (key) =>
        Effect.sync(() => {
          windows.delete(key);
          strikes.delete(key);
        }),
    };
  });
}
