import { createFileRoute } from "@tanstack/react-router";
import { ChannelId, seriesTemplateIds, seriesTemplateSeeds } from "@slipstream/domain";
import { compact, optionalEnum, optionalString } from "~/shell/search.ts";
import { SeriesEditorPage } from "~/modules/series/series-editor.tsx";

/**
 * The editor for a new series recording (SPEC §8.6). `template` starts from a template; `title`
 * and `channel` start from a programme ("Record every …" in the programme sheet).
 */
export const Route = createFileRoute("/_app/series/new")({
  staticData: { noMini: true },
  validateSearch: (search: Record<string, unknown>) =>
    compact({
      template: optionalEnum(search.template, seriesTemplateIds),
      title: optionalString(search.title),
      channel: optionalString(search.channel),
    }),
  component: Page,
});

function Page() {
  const { template, title, channel } = Route.useSearch();
  const seed = {
    ...(template === undefined ? {} : seriesTemplateSeeds[template]),
    ...(title === undefined ? {} : { title }),
    ...(channel === undefined ? {} : { channel: ChannelId.make(channel) }),
  };
  return <SeriesEditorPage key={`${template}:${title}:${channel}`} seed={seed} />;
}
