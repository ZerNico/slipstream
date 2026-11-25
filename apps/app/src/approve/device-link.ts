import { deviceLinkPath, type DeviceCodeApproval, normaliseUserCode } from "@slipstream/api";
import type { Profile, Role, UserId } from "@slipstream/domain";

/** The app's own URL scheme, registered in app.json. */
const APP_SCHEME = "slipstream:";

/**
 * The user code from a scanned or tapped sign-in link, or undefined when the URL is something
 * else. Accepts the server's approve page (`https://tv.example.com/link?code=QK74RM`, also behind
 * a base path) and the app's own `slipstream://link?code=QK74RM`.
 */
export const deviceLinkCode = (url: string): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // `slipstream://link` names the route as the host; `slipstream:///link` as the path.
  const route =
    parsed.protocol === APP_SCHEME
      ? `/${parsed.host}${parsed.pathname}`.replace(/\/{2,}/gu, "/")
      : parsed.protocol === "https:" || parsed.protocol === "http:"
        ? parsed.pathname
        : undefined;
  if (route === undefined || !route.replace(/\/+$/u, "").endsWith(deviceLinkPath)) {
    return undefined;
  }
  const code = normaliseUserCode(parsed.searchParams.get("code") ?? "");
  return code === "" ? undefined : code;
};

/** The person approving: who they are and whether they may sign the TV in as someone else. */
export interface Approver {
  readonly id: UserId;
  readonly displayName: string;
  readonly role: Role;
}

/**
 * Whom the TV can be signed in as: every household profile for an admin, otherwise only the
 * person approving (the server refuses anything else). The approver comes first.
 */
export const profileChoices = (
  me: Approver,
  profiles: readonly Pick<Profile, "id" | "displayName" | "role">[] | undefined,
): readonly Pick<Profile, "id" | "displayName" | "role">[] => {
  const self: Pick<Profile, "id" | "displayName" | "role"> = {
    id: me.id,
    displayName: me.displayName,
    role: me.role,
  };
  if (me.role !== "admin" || profiles === undefined) return [self];
  return [self, ...profiles.filter((profile) => profile.id !== me.id)];
};

/** The request for "Sign in on TV" as `profile`; `userId` is only sent for someone else. */
export const approveAs = (userCode: string, profile: UserId, me: Approver): DeviceCodeApproval =>
  profile === me.id ? { userCode, approve: true } : { userCode, approve: true, userId: profile };

/** The request for "This isn't my TV". */
export const blockSignIn = (userCode: string): DeviceCodeApproval => ({
  userCode,
  approve: false,
});

/** How a lookup or an answer failed, as the approve screen explains it. */
export type ApproveProblem = "invalidCode" | "forbidden" | "failed";

/**
 * Reads a failed lookup or approval: an unknown, expired or already answered code means "get a
 * new one on the TV"; anything else is a plain failure to retry.
 */
export const approveProblem = (error: unknown): ApproveProblem => {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined;
  if (tag === "NotFound" || tag === "DeviceCodeNotReady") return "invalidCode";
  if (tag === "Forbidden") return "forbidden";
  return "failed";
};
