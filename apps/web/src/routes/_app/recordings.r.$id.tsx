import { createFileRoute } from "@tanstack/react-router";
import { RecordingId } from "@slipstream/domain";
import { RecordingPage } from "~/modules/library/recording-page.tsx";

/**
 * The recording detail (SPEC §8.4, open issue #34).
 */
export const Route = createFileRoute("/_app/recordings/r/$id")({
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <RecordingPage key={id} id={RecordingId.make(id)} />;
}
