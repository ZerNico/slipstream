import { createFileRoute } from "@tanstack/react-router";
import { LinkPage } from "~/modules/auth/link-page.tsx";
import { requireSession } from "~/shell/route-guards.ts";
import { normaliseUserCode } from "@slipstream/api";

/**
 * TV approval (SPEC §8.8): the device, the code, the profile it signs in as. The TV's QR code
 * opens `/link?code=…`; signing in first comes back here with the code kept.
 */
export const Route = createFileRoute("/link")({
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search["code"] === "string" && normaliseUserCode(search["code"]) !== ""
      ? { code: normaliseUserCode(search["code"]) }
      : {},
  staticData: { full: true },
  beforeLoad: ({ context, location }) => requireSession(context, location),
  component: Page,
});

function Page() {
  const { code } = Route.useSearch();
  const { me } = Route.useRouteContext();
  return <LinkPage code={code} me={me} />;
}
