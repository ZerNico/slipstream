import { createFileRoute } from "@tanstack/react-router";
import { ChannelId } from "@slipstream/domain";
import { LivePlayerPage } from "~/modules/watch/watch-page.tsx";

/**
 * The player for a live channel (SPEC §7.1), full screen. A channel that is being recorded
 * plays from its recording at live instead, so it can be rewound.
 */
export const Route = createFileRoute("/_app/watch/live/$channel")({
  staticData: { full: true },
  component: Page,
});

function Page() {
  const { channel } = Route.useParams();
  return <LivePlayerPage key={channel} channelId={ChannelId.make(channel)} />;
}
