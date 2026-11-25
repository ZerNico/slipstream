import { useQuery } from "@tanstack/react-query";
import { m } from "@slipstream/i18n";
import { useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { Segmented } from "~/ui/controls.tsx";
import { SourcesSection } from "../sources-section.tsx";
import { ChannelLineup } from "./channel-lineup.tsx";

type View = "sources" | "channels";

/** A segment's label with its count, which keeps its room while loading so nothing moves. */
function Counted({ label, count }: { label: string; count: number | undefined }) {
  return (
    <>
      {label}
      <span className="chip-count inline-block min-w-[3ch] text-left tabular-nums">
        {count ?? ""}
      </span>
    </>
  );
}

/**
 * Settings › Sources & channels (SPEC §8.7): a Sources | Channels switch with counts. Sources
 * are the source cards; Channels is the lineup.
 */
export function SourcesAndChannels() {
  const queries = useQueries();
  const sources = useQuery(queries.sources());
  const channels = useQuery(queries.channels());
  const [view, setView] = useState<View>("sources");
  return (
    <>
      <div className="mb-5 flex min-h-9 flex-wrap items-center gap-3">
        <h2 className="type-h3">{m.settings_section_sources()}</h2>
        <Segmented<View>
          label={m.lineup_switch_label()}
          value={view}
          onChange={setView}
          segments={[
            {
              value: "sources",
              label: <Counted label={m.sources_heading()} count={sources.data?.length} />,
            },
            {
              value: "channels",
              label: <Counted label={m.channels_heading()} count={channels.data?.length} />,
            },
          ]}
        />
      </div>
      {view === "sources" ? <SourcesSection /> : <ChannelLineup />}
    </>
  );
}
