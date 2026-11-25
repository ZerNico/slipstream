import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/settings` opens the first section: This device, for everyone (SPEC §7.8, §8.7).
 */
export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/$section", params: { section: "device" }, replace: true });
  },
});
