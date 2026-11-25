import { SourceFailed } from "@slipstream/api";
import { m, sourceFailureReasonText } from "@slipstream/i18n";
import { Predicate } from "effect";

/*
 * The one reading of a failed call for every screen. The typed client fails with the contract's
 * tagged errors; a request that never reached the server fails with the HTTP client's transport
 * error, read here as `Offline`.
 */

/** The `_tag` and fields of a failed call, for saying what went wrong. */
export interface Failure {
  /** The contract's error tag, `Offline` when the server was not reached, else empty. */
  readonly tag: string;
  /** A `Conflict`'s code (`lastAdmin`). */
  readonly code: string | undefined;
  /** A `RateLimited`'s wait. */
  readonly retryAfterSeconds: number | undefined;
}

const isOffline = (error: unknown): boolean =>
  Predicate.isTagged(error, "HttpClientError") &&
  Predicate.hasProperty(error, "reason") &&
  Predicate.isTagged(error.reason, "TransportError");

/** Reads a failed call's tag, conflict code and wait. */
export const failureOf = (error: unknown): Failure => {
  const tag = isOffline(error)
    ? "Offline"
    : Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag)
      ? error._tag
      : "";
  return {
    tag,
    code:
      Predicate.hasProperty(error, "code") && Predicate.isString(error.code)
        ? error.code
        : undefined,
    retryAfterSeconds:
      Predicate.hasProperty(error, "retryAfterSeconds") &&
      Predicate.isNumber(error.retryAfterSeconds)
        ? error.retryAfterSeconds
        : undefined,
  };
};

/** What a page says when its data could not be read: only admins may, offline, or anything else. */
export const readProblem = (error: unknown): string => {
  const { tag } = failureOf(error);
  if (tag === "Forbidden") return m.state_forbidden();
  if (tag === "Offline") return m.error_offline();
  return m.error_unexpected();
};

/** Why a source test, refresh or save failed, in words that point at the fix. */
export const sourceProblem = (error: unknown): string => {
  // The typed client fails with the contract's own error class.
  return error instanceof SourceFailed ? sourceFailureReasonText(error) : readProblem(error);
};
