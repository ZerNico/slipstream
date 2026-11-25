import { Outlet, createFileRoute } from "@tanstack/react-router";
import { HouseholdZone } from "~/api/household-zone.tsx";
import { AppShell } from "~/shell/app-shell.tsx";
import { requireSession, requireSetupDone } from "~/shell/route-guards.ts";

/**
 * Everything behind sign-in, inside the app shell, with times written in the household's zone.
 * A fresh server goes to first-run setup; without a session the person signs in and comes back
 * here.
 */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    await requireSetupDone(context);
    return requireSession(context, location);
  },
  component: App,
});

function App() {
  return (
    <HouseholdZone>
      <AppShell>
        <Outlet />
      </AppShell>
    </HouseholdZone>
  );
}
