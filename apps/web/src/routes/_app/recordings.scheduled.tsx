import { createFileRoute } from "@tanstack/react-router";
import { ScheduledPage } from "~/modules/library/scheduled-page.tsx";

/**
 * Recordings › Scheduled (SPEC §8.4): by day, conflicts with every way out.
 */
export const Route = createFileRoute("/_app/recordings/scheduled")({
  component: Page,
});

function Page() {
  return <ScheduledPage />;
}
