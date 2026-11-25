import { createFileRoute } from "@tanstack/react-router";
import { ProblemsPage } from "~/modules/library/problems-page.tsx";

/**
 * Recordings › Problems (SPEC §8.4): issue cards with their fixes.
 */
export const Route = createFileRoute("/_app/recordings/problems")({
  component: Page,
});

function Page() {
  return <ProblemsPage />;
}
