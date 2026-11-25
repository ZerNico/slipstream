import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { NowNext } from "@slipstream/api";
import { type Channel, channelChangePayload, channelMark } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { DateTime } from "effect";
import { type ReactNode, type Ref, useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { useUpdateChannel } from "~/api/mutations.ts";
import { formatClock } from "~/i18n/formats.ts";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Badge } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, PlayIcon } from "~/ui/icons.ts";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Switch } from "~/ui/primitives/switch.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { LogoDialog } from "../logo-dialog.tsx";
import { AddStreamDialog } from "../review/add-stream-dialog.tsx";
import { ChannelMenu, FavouriteButton } from "./actions.tsx";
import { useLineupActions } from "./actions-context.ts";
import { GuidePicker } from "./guide-picker.tsx";
import { channelLine, type LineupStreams } from "./model.ts";
import { NumberField } from "./number-field.tsx";
import { useLineupQueries } from "./queries.ts";
import { StreamList } from "./stream-list.tsx";

/** Text that reads as plain text until clicked, then edits in place; saves on Enter or blur. */
function InlineText({
  value,
  label,
  className,
  onSave,
}: {
  value: string;
  label: string;
  className?: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next === "" || next === value) setDraft(value);
    else onSave(next);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      className={cn(
        "h-9 min-w-0 rounded-md border border-transparent bg-transparent px-2 outline-none coarse:h-11",
        "fine:hover:border-line focus:border-line-2 focus:bg-sunken",
        className,
      )}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A section of the detail: a heading with a quiet note, then its content. */
function DetailSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="flex items-baseline gap-2 font-semibold">
        {title}
        {note === undefined ? null : (
          <span className="text-meta font-normal text-fg-3">{note}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** One programme line of the guide preview: its time, title and whether it is on now. */
function GuideLine({ start, title, tag }: { start: number; title: string; tag: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-16 flex-none whitespace-nowrap text-meta text-fg-2 tabular-nums">
        {formatClock(start)}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="flex-none text-caption text-fg-3">{tag}</span>
    </li>
  );
}

/** The channel's guide: the guide channel it is mapped to, what is on now and next, Change. */
function GuideSection({ channel }: { channel: Channel }) {
  const queries = useQueries();
  const lineup = useLineupQueries();
  const [picking, setPicking] = useState(false);
  const mapped = channel.guideChannelId;
  const found = useQuery({
    ...lineup.guideChannels(mapped ?? ""),
    enabled: mapped !== undefined,
  });
  const guide = found.data?.find((option) => option.xmltvId === mapped);
  const nowNext = useQuery(queries.nowNext());
  const slot: NowNext | undefined = nowNext.data?.find((entry) => entry.channelId === channel.id);
  const lines = [
    slot?.now === undefined
      ? undefined
      : { key: "now", programme: slot.now, tag: m.lineup_guide_now() },
    slot?.next === undefined
      ? undefined
      : { key: "next", programme: slot.next, tag: m.lineup_guide_next() },
  ].filter((line) => line !== undefined);
  return (
    <DetailSection title={m.lineup_guide()}>
      <div className="panel divide-y divide-line overflow-hidden">
        <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
          <div className="grid min-w-0 flex-1">
            {mapped === undefined ? (
              <span>
                <Badge tone="warn">{m.lineup_no_guide()}</Badge>
              </span>
            ) : (
              <>
                <span className="truncate font-semibold">{guide?.displayName ?? mapped}</span>
                <span className="truncate font-mono text-caption text-fg-3">{mapped}</span>
              </>
            )}
          </div>
          <Button size="sm" onClick={() => setPicking(true)}>
            {mapped === undefined ? m.lineup_guide_choose() : m.lineup_guide_change()}
          </Button>
        </div>
        {mapped === undefined ? null : (
          <ul className="min-h-20" aria-label={m.lineup_guide()}>
            {channel.hidden ? (
              <li className="px-4 py-2.5 text-meta text-fg-3">{m.lineup_guide_hidden()}</li>
            ) : lines.length === 0 ? (
              <li className="px-4 py-2.5 text-meta text-fg-3">
                {nowNext.data === undefined ? " " : m.lineup_guide_nothing()}
              </li>
            ) : (
              lines.map((line) => (
                <GuideLine
                  key={line.key}
                  start={DateTime.toEpochMillis(line.programme.start)}
                  title={line.programme.title}
                  tag={line.tag}
                />
              ))
            )}
          </ul>
        )}
      </div>
      {picking ? <GuidePicker channel={channel} open={picking} onOpenChange={setPicking} /> : null}
    </DetailSection>
  );
}

/**
 * One channel in full (the lineup's right pane, a sheet on narrow screens): logo, name and
 * number to edit in place, favourite, watch and its menu; whether it shows; its streams in
 * fallback order; and its guide.
 */
export function ChannelDetail({
  channel,
  lineup,
  streams,
  numberRef,
}: {
  channel: Channel;
  lineup: readonly Channel[];
  streams: LineupStreams;
  numberRef?: Ref<HTMLInputElement>;
}) {
  const actions = useLineupActions();
  const { mutate } = useUpdateChannel();
  const [logoOpen, setLogoOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-6 p-5">
      <header className="flex items-start gap-4">
        <button
          type="button"
          aria-label={m.channel_logo_title({ name: channel.name })}
          className="flex-none rounded-md focus-visible:outline-2 focus-visible:outline-focus"
          onClick={() => setLogoOpen(true)}
        >
          <ChannelLogo
            mark={channelMark(channel.name)}
            size="lg"
            {...(channel.logoUrl ? { logoUrl: channel.logoUrl } : {})}
          />
        </button>
        <div className="grid min-w-0 flex-1 gap-1">
          <InlineText
            key={channel.name}
            className="-ml-2 w-full type-h3"
            label={m.channel_name_of({ name: channel.name })}
            value={channel.name}
            onSave={(name) => actions.rename(channel.id, name)}
          />
          <div className="flex min-w-0 items-center gap-2 text-meta text-fg-2">
            <span className="flex-none text-fg-3">{m.lineup_number()}</span>
            <NumberField
              key={channel.id}
              channel={channel}
              lineup={lineup}
              inputRef={numberRef}
              onSave={(number) => actions.setNumber(channel.id, number)}
            />
            <span className="min-w-0 truncate">
              {channelLine(streams.byChannel.get(channel.id))}
            </span>
          </div>
        </div>
        <div className="flex flex-none items-center">
          <FavouriteButton channel={channel} />
          <IconButton
            size="sm"
            label={m.lineup_watch()}
            render={<Link to="/watch/live/$channel" params={{ channel: channel.id }} />}
            nativeButton={false}
          >
            <Icon icon={PlayIcon} size={16} />
          </IconButton>
          <ChannelMenu channel={channel} selectable={false} />
        </div>
      </header>
      <label className="panel flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
        <span>{m.lineup_visible_title()}</span>
        <Switch
          checked={!channel.hidden}
          aria-label={m.channel_visible({ name: channel.name })}
          onCheckedChange={(visible) => actions.setHidden([channel.id], !visible)}
        />
      </label>
      <DetailSection title={m.lineup_streams()} note={m.lineup_streams_note()}>
        <StreamList key={channel.id} channel={channel} streams={streams} />
        <Button
          variant="ghost"
          className="justify-self-start"
          icon={<Icon icon={AddIcon} />}
          onClick={() => setAdding(true)}
        >
          {m.stream_add_from_source()}
        </Button>
        {adding ? (
          <AddStreamDialog channel={channel} open={adding} onOpenChange={setAdding} />
        ) : null}
      </DetailSection>
      <GuideSection key={channel.id} channel={channel} />
      {logoOpen ? (
        <LogoDialog
          channel={channel}
          open={logoOpen}
          onOpenChange={setLogoOpen}
          onSave={(logoUrl) =>
            mutate(
              { id: channel.id, update: channelChangePayload({ logoUrl }) },
              { onError: () => toast({ title: m.state_not_saved(), type: "error" }) },
            )
          }
        />
      ) : null}
    </div>
  );
}
