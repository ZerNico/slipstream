import { createFileRoute } from "@tanstack/react-router";
import { SeriesPage } from "~/modules/series/series-page.tsx";

/**
 * Series recordings (SPEC §8.6, recording model §1): the series cards and templates.
 */
export const Route = createFileRoute("/_app/series/")({
  component: SeriesPage,
});
