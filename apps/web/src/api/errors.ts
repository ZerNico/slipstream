import type {
  AlreadySetUp,
  Conflict,
  DeviceCodeNotReady,
  Forbidden,
  InvalidCredentials,
  InvalidInput,
  InviteInvalid,
  NotFound,
  ProfileLocked,
  RangeNotCaptured,
  RateLimited,
  SetupRequired,
  SourceFailed,
  StreamLimitReached,
  Unauthorized,
} from "@slipstream/api";

/** A typed error the contract declares. Each carries structure, never text. */
export type ContractError =
  | AlreadySetUp
  | Conflict
  | DeviceCodeNotReady
  | Forbidden
  | InvalidCredentials
  | InvalidInput
  | InviteInvalid
  | NotFound
  | ProfileLocked
  | RangeNotCaptured
  | RateLimited
  | SetupRequired
  | SourceFailed
  | StreamLimitReached
  | Unauthorized;

/**
 * Why a call failed, in terms a screen can phrase: a declared error, no connection, or
 * something unexpected (a bug, a bad response, a status the contract does not declare).
 */
export type ApiProblem =
  | ContractError
  | { readonly _tag: "Offline" }
  | { readonly _tag: "Unexpected" };

const contractTags: ReadonlySet<string> = new Set<ContractError["_tag"]>([
  "AlreadySetUp",
  "Conflict",
  "DeviceCodeNotReady",
  "Forbidden",
  "InvalidCredentials",
  "InvalidInput",
  "InviteInvalid",
  "NotFound",
  "ProfileLocked",
  "RangeNotCaptured",
  "RateLimited",
  "SetupRequired",
  "SourceFailed",
  "StreamLimitReached",
  "Unauthorized",
]);

const tagOf = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string"
    ? value._tag
    : undefined;

/**
 * Classifies whatever an Effect call failed with. A transport failure means the server could
 * not be reached; anything the contract does not declare is unexpected.
 */
export const toProblem = (error: unknown): ApiProblem => {
  const tag = tagOf(error);
  if (tag !== undefined && contractTags.has(tag)) return error as ContractError;
  if (
    tag === "HttpClientError" &&
    typeof error === "object" &&
    error !== null &&
    "reason" in error
  ) {
    if (tagOf(error.reason) === "TransportError") return { _tag: "Offline" };
  }
  return { _tag: "Unexpected" };
};

/** What a rejected API promise carries, so TanStack Query errors stay typed. */
export class ApiError extends Error {
  readonly problem: ApiProblem;
  constructor(problem: ApiProblem) {
    super(problem._tag);
    this.name = "ApiError";
    this.problem = problem;
  }
}

/** The problem behind any error a query or mutation reports. */
export const problemOf = (error: unknown): ApiProblem =>
  error instanceof ApiError ? error.problem : { _tag: "Unexpected" };

/** True when the error means the session is gone and the person must sign in again. */
export const isUnauthorized = (error: unknown): boolean => problemOf(error)._tag === "Unauthorized";

/**
 * Whether asking again may help: only when the server could not be reached or answered
 * something unexpected. A declared error (no session, not found, refused) answers the same
 * the second time.
 */
export const isTransient = (error: unknown): boolean => {
  const tag = problemOf(error)._tag;
  return tag === "Offline" || tag === "Unexpected";
};
