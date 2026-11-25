import { m } from "@slipstream/i18n";
import { failureOf } from "../../../api/failure.ts";

/** Where a form says what went wrong: under the current PIN, or at the end of the form. */
export interface FormProblem {
  readonly field: "currentPin" | "form";
  readonly text: string;
}

/**
 * What a failed profile save or delete says, as the web's profile dialog does: the last admin
 * can't go, a wrong current PIN, too many tries, or "Not saved".
 */
export const profileProblem = (error: unknown): FormProblem => {
  const failure = failureOf(error);
  if (failure.tag === "Conflict" && failure.code === "lastAdmin") {
    return { field: "form", text: m.users_conflict_last_admin() };
  }
  if (failure.tag === "InvalidCredentials") {
    return { field: "currentPin", text: m.profile_pin_wrong() };
  }
  if (failure.tag === "RateLimited") {
    return {
      field: "currentPin",
      text: m.signin_rate_limited({ seconds: failure.retryAfterSeconds ?? 60 }),
    };
  }
  if (failure.tag === "Offline") {
    return { field: "form", text: m.error_offline() };
  }
  return { field: "form", text: m.state_not_saved() };
};
