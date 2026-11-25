import { createFileRoute } from "@tanstack/react-router";
import { CollectionId } from "@slipstream/domain";
import { CollectionEditor } from "~/modules/library/collection-editor.tsx";

/**
 * The collection editor for an existing collection (SPEC §8.5).
 */
export const Route = createFileRoute("/_app/recordings/collections/$id")({
  staticData: { noMini: true },
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <CollectionEditor key={id} id={CollectionId.make(id)} />;
}
