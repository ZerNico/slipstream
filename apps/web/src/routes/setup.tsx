import { createFileRoute } from "@tanstack/react-router";
import { SetupPage } from "~/modules/auth/setup-page.tsx";
import { requireSetupPending } from "~/shell/route-guards.ts";

/**
 * First-run setup (SPEC §8.8): four steps, the source tested before continuing. A server that
 * is set up already sends people to sign in.
 */
export const Route = createFileRoute("/setup")({
  staticData: { full: true },
  beforeLoad: ({ context }) => requireSetupPending(context),
  component: SetupPage,
});
