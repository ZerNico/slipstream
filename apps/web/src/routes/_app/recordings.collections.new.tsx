import { createFileRoute } from "@tanstack/react-router";
import { compact, optionalString } from "~/shell/search.ts";
import { CollectionEditor } from "~/modules/library/collection-editor.tsx";

/**
 * The collection editor for a new collection (SPEC §8.5). Search: `from` (a group to start
 * from).
 */
export const Route = createFileRoute("/_app/recordings/collections/new")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({ from: optionalString(search["from"]) }),
  staticData: { noMini: true },
  component: Page,
});

function Page() {
  const { from } = Route.useSearch();
  return <CollectionEditor key={from ?? ""} {...(from === undefined ? {} : { from })} />;
}
