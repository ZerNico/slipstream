import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "~/modules/auth/login-page.tsx";
import { requireSetupDone } from "~/shell/route-guards.ts";
import { compact, optionalString } from "~/shell/search.ts";

/**
 * Sign-in (SPEC §8.8): password, inline errors. Search: `redirect` (where to go after). A
 * fresh server goes to first-run setup instead.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({ redirect: optionalString(search["redirect"]) }),
  staticData: { full: true },
  beforeLoad: ({ context }) => requireSetupDone(context),
  component: Page,
});

function Page() {
  return <LoginPage redirect={Route.useSearch().redirect} />;
}
