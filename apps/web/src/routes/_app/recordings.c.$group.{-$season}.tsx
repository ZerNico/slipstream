import { createFileRoute } from "@tanstack/react-router";
import { GroupPage } from "~/modules/library/group-page.tsx";

/**
 * A collection or automatic group page, optionally one season (SPEC §7.5, §8.4).
 */
export const Route = createFileRoute("/_app/recordings/c/$group/{-$season}")({
  component: Page,
});

function Page() {
  const { group, season } = Route.useParams();
  return <GroupPage groupKey={group} season={season} />;
}
