import { createFileRoute, redirect } from "@tanstack/react-router";

/** The old address of a series recording's editor: lands on `/series/$id`. */
export const Route = createFileRoute("/_app/rules/$id")({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: "/series/$id", params, search, replace: true });
  },
});
