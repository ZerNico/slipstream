import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "~/modules/library/library-page.tsx";
import { compact, optionalEnum, optionalString } from "~/shell/search.ts";

/**
 * Recordings › Library (SPEC §8.4). Search: `group`, `filter`, `q`.
 */
export const Route = createFileRoute("/_app/recordings/")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({
      group: optionalEnum(search["group"], ["collections", "channel", "date"] as const),
      filter: optionalEnum(search["filter"], ["all", "unwatched", "mine"] as const),
      q: optionalString(search["q"]),
    }),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  return (
    <LibraryPage
      view={search.group ?? "collections"}
      filter={search.filter ?? "all"}
      query={search.q ?? ""}
    />
  );
}
