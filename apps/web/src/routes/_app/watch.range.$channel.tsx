import { createFileRoute } from "@tanstack/react-router";
import { ChannelId } from "@slipstream/domain";
import { RangePlayerPage } from "~/modules/watch/watch-page.tsx";
import { compact, optionalNumber } from "~/shell/search.ts";

/**
 * The player for a stretch of a channel the pause buffer still holds (SPEC §7.6): an ended
 * programme nobody recorded, watched from its start. Search: `start` and `end`, epoch ms; a
 * missing or empty range says it isn't available. Owned by the watch track.
 */
export const Route = createFileRoute("/_app/watch/range/$channel")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({ start: optionalNumber(search["start"]), end: optionalNumber(search["end"]) }),
  staticData: { full: true },
  component: Page,
});

function Page() {
  const { channel } = Route.useParams();
  const { start, end } = Route.useSearch();
  const range =
    start !== undefined && end !== undefined && end > start ? { start, end } : undefined;
  return (
    <RangePlayerPage
      key={[channel, start, end].join(":")}
      channelId={ChannelId.make(channel)}
      range={range}
    />
  );
}
