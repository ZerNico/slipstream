import { createFileRoute, notFound } from "@tanstack/react-router";
import { KitchenSink } from "~/shell/kitchen-sink.tsx";

/**
 * Every shared component in one page, for design review and the layout screenshots
 * (`/dev/kitchen-sink`). Development builds only.
 */
export const Route = createFileRoute("/_app/dev/kitchen-sink")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: KitchenSink,
});
