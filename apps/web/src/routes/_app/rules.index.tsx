import { createFileRoute, redirect } from "@tanstack/react-router";

/** The old address of Series recordings: old links and bookmarks land on `/series`. */
export const Route = createFileRoute("/_app/rules/")({
  beforeLoad: () => {
    throw redirect({ to: "/series", replace: true });
  },
});
