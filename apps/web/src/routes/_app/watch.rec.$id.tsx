import { createFileRoute } from "@tanstack/react-router";
import { RecordingId } from "@slipstream/domain";
import { RecordingPlayerPage } from "~/modules/watch/watch-page.tsx";
import { compact, optionalEnum, optionalNumber } from "~/shell/search.ts";

/**
 * The player for a recording (SPEC §7.1), full screen. Search: `at` (resume, start, live, pos)
 * and `t` (where to start: a wall-clock time for a running recording, a position in ms or a
 * wall-clock time for a finished one).
 */
export const Route = createFileRoute("/_app/watch/rec/$id")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({
      at: optionalEnum(search["at"], ["resume", "start", "live", "pos"] as const),
      t: optionalNumber(search["t"]),
    }),
  staticData: { full: true },
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  // A new recording is a new player: nothing of the last one's position carries over.
  return <RecordingPlayerPage key={id} id={RecordingId.make(id)} search={search} />;
}
