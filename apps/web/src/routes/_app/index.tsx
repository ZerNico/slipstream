import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "~/modules/home/home-page.tsx";

/**
 * Home (SPEC §8.1): the hero (five states, `under` the transparent top bar), Needs attention,
 * the media rows and the server strip.
 */
export const Route = createFileRoute("/_app/")({
  staticData: { under: true },
  component: HomePage,
});
