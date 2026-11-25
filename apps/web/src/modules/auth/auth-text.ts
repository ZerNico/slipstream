import { passwordMinLength } from "@slipstream/api";
import type { DeviceKind } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { problemOf } from "~/api/errors.ts";
import { problemTitle } from "~/api/problem-title.ts";

/** Only same-site paths come back from `?redirect=`, never another origin. */
export const safeRedirect = (value: string | undefined): string | undefined =>
  value !== undefined && value.startsWith("/") && !value.startsWith("//") ? value : undefined;

/** The words for a failed sign-in, shown under the password. */
export const signInError = (error: unknown): string => {
  const problem = problemOf(error);
  if (problem._tag === "InvalidCredentials") return m.signin_wrong();
  if (problem._tag === "RateLimited") {
    return m.signin_rate_limited({ seconds: problem.retryAfterSeconds });
  }
  return problemTitle(error);
};

/** How strong a new password is: 0 (too short) to 4, for the four-bar meter. */
export const passwordStrength = (password: string): 0 | 1 | 2 | 3 | 4 => {
  if (password.length < passwordMinLength) return 0;
  const kinds = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z\d]/u].filter((kind) =>
    kind.test(password),
  ).length;
  const long = password.length >= 16 ? 1 : 0;
  return Math.min(4, Math.max(1, kinds - 1 + long)) as 1 | 2 | 3 | 4;
};

/** The hint under a new password: what is missing, or how strong it is. */
export const passwordHint = (password: string): string => {
  const strength = passwordStrength(password);
  if (strength === 0) return m.setup_password_hint({ min: passwordMinLength });
  if (strength <= 2) return m.password_fair({ length: password.length });
  return m.password_strong({ length: password.length });
};

/** Why an invite link can't be used, in words that say what to do. */
export const inviteError = (error: unknown): string => {
  const problem = problemOf(error);
  if (problem._tag === "InviteInvalid") {
    switch (problem.reason) {
      case "expired":
        return m.invite_invalid_expired();
      case "used":
        return m.invite_invalid_used();
      case "revoked":
        return m.invite_invalid_revoked();
    }
  }
  if (problem._tag === "NotFound") return m.invite_unknown();
  if (problem._tag === "Conflict") return m.users_conflict_username_taken();
  if (problem._tag === "RateLimited") {
    return m.signin_rate_limited({ seconds: problem.retryAfterSeconds });
  }
  return problemTitle(error);
};

/** The words for a kind of device ("TV", "Phone"). */
export const deviceKindLabel = (kind: DeviceKind): string => {
  switch (kind) {
    case "tv":
      return m.device_kind_tv();
    case "phone":
      return m.device_kind_phone();
    case "tablet":
      return m.device_kind_tablet();
    case "web":
      return m.device_kind_web();
  }
};
