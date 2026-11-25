import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The old address of the new series recording editor: keeps the search (`template`, `title`,
 * `channel`) and lands on `/series/new`, which checks it.
 */
export const Route = createFileRoute("/_app/rules/new")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/series/new", search, replace: true });
  },
});
