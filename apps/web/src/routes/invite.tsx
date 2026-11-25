import { createFileRoute } from "@tanstack/react-router";
import { InvitePage } from "~/modules/auth/invite-page.tsx";
import { compact, optionalString } from "~/shell/search.ts";

/**
 * A guest invite (SPEC §7.8): `inviteAcceptPath` in the contract, the token in `?token=`. Public:
 * the guest has no account yet.
 */
export const Route = createFileRoute("/invite")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({ token: optionalString(search["token"]) }),
  staticData: { full: true },
  component: Page,
});

function Page() {
  return <InvitePage token={Route.useSearch().token} />;
}
