import { createFileRoute } from "@tanstack/react-router";
import { RecordingId } from "@slipstream/domain";
import { RecordingPage } from "~/modules/library/recording-page.tsx";
import { compact, optionalEnum } from "~/shell/search.ts";

/**
 * The recording detail (SPEC §8.4, open issue #34). Search: `ask=delete` opens it with the
 * Delete question showing (a card's ⋯ menu › Delete…).
 */
export const Route = createFileRoute("/_app/recordings/r/$id")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({ ask: optionalEnum(search["ask"], ["delete"] as const) }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const { ask } = Route.useSearch();
  return <RecordingPage key={id} id={RecordingId.make(id)} askDelete={ask === "delete"} />;
}
