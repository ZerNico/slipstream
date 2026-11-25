import { useQueries as useQueryList, useQuery } from "@tanstack/react-query";
import {
  type Channel,
  type ChannelId,
  type LineupFilter,
  type LineupView,
  lineupCounts,
  matchesLineup,
  rangeBetween,
  topNumber,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { type KeyboardEvent, useRef, useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { useUpdateChannel } from "~/api/mutations.ts";
import { Chip, SearchField, Segmented } from "~/ui/controls.tsx";
import { Icon, type IconSvgElement } from "~/ui/icon.tsx";
import {
  CloseIcon,
  DeleteIcon,
  FavouriteIcon,
  HideIcon,
  NumberIcon,
  ShowIcon,
} from "~/ui/icons.ts";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Kbd } from "~/ui/primitives/kbd.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { Sheet } from "~/ui/sheet/sheet.tsx";
import { LoadingScope } from "~/ui/skeleton.tsx";
import { rememberedList } from "~/ui/skeleton-state.ts";
import { toast } from "~/ui/toast-manager.ts";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";
import { SectionProblem } from "../section-problem.tsx";
import { type LineupActions, LineupActionsContext } from "./actions-context.ts";
import { ChannelDetail } from "./channel-detail.tsx";
import { MoveDialog, RemoveDialog } from "./dialogs.tsx";
import { LineupList } from "./lineup-list.tsx";
import { lineupStreams, originOf } from "./model.ts";
import { useLineupQueries, usePlaceNumbers, useSetNumber, useUpdateChannels } from "./queries.ts";

const notSaved = () => toast({ title: m.state_not_saved(), type: "error" });

const placeholderChannel = (index: number): Channel => ({
  id: `placeholder-${index}` as ChannelId,
  name: "Channel name",
  number: index + 1,
  guideChannelId: "channel.de",
  favourite: false,
  hidden: false,
});

/** "Any" in the source and group selects; the empty group is spelled out. */
const ANY = "*";
const NO_GROUP = "~";

/** One action of the bulk bar: icon and label, the label for assistive tech only when narrow. */
function BulkAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconSvgElement;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Icon icon={icon} size={16} />}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span className="@max-2xl:sr-only">{label}</span>
    </Button>
  );
}

/** The bulk bar: what to do with the selected channels. It floats, so nothing moves. */
function BulkBar({
  count,
  onClear,
  onHide,
  onShow,
  onMove,
  onFavourite,
  onRemove,
}: {
  count: number;
  onClear: () => void;
  onHide: () => void;
  onShow: () => void;
  onMove: () => void;
  onFavourite: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label={m.lineup_selected({ count })}
      className="absolute inset-x-3 bottom-3 z-3 mx-auto flex w-fit max-w-[calc(100%-24px)] items-center gap-0.5 rounded-full bg-raised px-2 py-1 shadow-pop"
    >
      <IconButton size="sm" label={m.lineup_clear_selection()} onClick={onClear}>
        <Icon icon={CloseIcon} size={16} />
      </IconButton>
      <span className="pr-2 pl-1 text-meta font-semibold whitespace-nowrap tabular-nums">
        {m.lineup_selected({ count })}
      </span>
      <BulkAction label={m.lineup_hide()} icon={HideIcon} onClick={onHide} />
      <BulkAction label={m.lineup_show()} icon={ShowIcon} onClick={onShow} />
      <BulkAction label={m.lineup_move_to_number()} icon={NumberIcon} onClick={onMove} />
      <BulkAction label={m.lineup_favourite()} icon={FavouriteIcon} onClick={onFavourite} />
      <BulkAction label={m.lineup_remove()} icon={DeleteIcon} onClick={onRemove} />
    </div>
  );
}

/**
 * Settings › Sources & channels › Channels: the lineup as a list with the open channel's
 * detail beside it (a sheet on narrow screens). Numbers are fixed and typed in place; Hide is
 * the everyday action, Remove waits in menus and the bulk bar.
 */
export function ChannelLineup() {
  const queries = useQueries();
  const lineupQueries = useLineupQueries();
  const channels = useQuery(queries.channels());
  const sources = useQuery(queries.sources());
  const sourceList = sources.data ?? [];
  const pages = useQueryList({
    queries: sourceList.map((source) => lineupQueries.added(source.id)),
  });
  const streams = lineupStreams(
    sourceList,
    pages.map((page) => page.data),
  );
  const wide = useMediaQuery(media.tablet);
  const updateOne = useUpdateChannel();
  const updateMany = useUpdateChannels();
  const setNumber = useSetNumber();
  const place = usePlaceNumbers();

  const [filter, setFilter] = useState<LineupFilter>({
    view: "all",
    search: "",
    noGuide: false,
    favourites: false,
  });
  const [openId, setOpenId] = useState<ChannelId | undefined>(undefined);
  const [selected, setSelected] = useState<ReadonlySet<ChannelId>>(new Set());
  const [anchor, setAnchor] = useState<ChannelId | undefined>(undefined);
  const [moving, setMoving] = useState<readonly ChannelId[] | undefined>(undefined);
  const [removing, setRemoving] = useState<readonly ChannelId[] | undefined>(undefined);
  const numberRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loading = channels.isPending;
  const all = rememberedList("settings.channels", channels.data, 12, placeholderChannel);
  const lineup = channels.data ?? [];
  const counts = lineupCounts(lineup);
  const shown = all.filter((channel) =>
    matchesLineup(channel, filter, originOf(streams.byChannel.get(channel.id))),
  );
  const byId = new Map(lineup.map((channel) => [channel.id, channel]));
  const open = openId === undefined ? undefined : byId.get(openId);
  const inOrder = (ids: Iterable<ChannelId>) => {
    const wanted = new Set(ids);
    return lineup.filter((channel) => wanted.has(channel.id));
  };
  const patch = (ids: readonly ChannelId[], update: { hidden?: boolean; favourite?: boolean }) =>
    updateMany.mutate({ ids, update }, { onError: notSaved });

  const actions: LineupActions = {
    open: setOpenId,
    select: (id, range) => {
      const order = shown.map((channel) => channel.id);
      const next = new Set(selected);
      if (range && anchor !== undefined) {
        for (const each of rangeBetween(order, anchor, id)) next.add(each);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      setAnchor(id);
    },
    moveToTop: (ids) =>
      place.mutate(
        { ids: inOrder(ids).map((channel) => channel.id), start: topNumber(lineup) },
        { onError: notSaved },
      ),
    moveToNumber: (ids) => setMoving(ids),
    setNumber: (id, number) => setNumber.mutate({ id, number }, { onError: notSaved }),
    setHidden: (ids, hidden) => patch(ids, { hidden }),
    setFavourite: (ids, favourite) => patch(ids, { favourite }),
    rename: (id, name) => updateOne.mutate({ id, update: { name } }, { onError: notSaved }),
    remove: (ids) => setRemoving(ids),
  };

  const selectedIds = inOrder(selected).map((channel) => channel.id);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
    const index = shown.findIndex((channel) => channel.id === openId);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        shown[
          Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
        ];
      if (next === undefined) return;
      setOpenId(next.id);
      // The row may only exist once the list scrolled to it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-channel="${CSS.escape(next.id)}"]`)?.focus(),
        ),
      );
    }
    if (open !== undefined && (event.key === "h" || event.key === "H")) {
      event.preventDefault();
      actions.setHidden([open.id], !open.hidden);
    }
    if (open !== undefined && event.key === "#") {
      event.preventDefault();
      if (wide) numberRef.current?.focus();
      else setMoving([open.id]);
    }
  };

  if (channels.isError) return <SectionProblem error={channels.error} />;

  const groupValue =
    filter.group === undefined ? ANY : filter.group === "" ? NO_GROUP : filter.group;
  const detail =
    open === undefined ? null : (
      <ChannelDetail
        key={open.id}
        channel={open}
        lineup={lineup}
        streams={streams}
        numberRef={numberRef}
      />
    );

  return (
    <LineupActionsContext value={actions}>
      <LoadingScope loading={loading}>
        <div className="panel grid h-[clamp(520px,calc(100dvh-var(--nav-h)-200px),900px)] overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="@container relative flex min-h-0 flex-col md:border-r md:border-line">
            <div className="grid gap-2.5 border-b border-line p-3">
              <SearchField
                ref={searchRef}
                value={filter.search}
                placeholder={m.lineup_search()}
                aria-label={m.lineup_search()}
                onChange={(event) => setFilter({ ...filter, search: event.target.value })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<LineupView>
                  label={m.lineup_view_label()}
                  value={filter.view}
                  onChange={(view) => setFilter({ ...filter, view })}
                  segments={[
                    { value: "all", label: m.lineup_view_all() },
                    { value: "visible", label: m.lineup_view_visible() },
                    { value: "hidden", label: m.lineup_view_hidden() },
                  ]}
                />
                <Chip
                  size="sm"
                  pressed={filter.noGuide}
                  count={counts.noGuide}
                  onPressedChange={(noGuide) => setFilter({ ...filter, noGuide })}
                >
                  {m.lineup_no_guide()}
                </Chip>
                <Chip
                  size="sm"
                  pressed={filter.favourites}
                  count={counts.favourites}
                  onPressedChange={(favourites) => setFilter({ ...filter, favourites })}
                >
                  {m.lineup_favourites()}
                </Chip>
                <Select
                  className="h-8 w-auto max-w-40"
                  aria-label={m.lineup_source_filter()}
                  value={filter.sourceId ?? ANY}
                  options={[
                    { value: ANY, label: m.lineup_any_source() },
                    ...sourceList.map((source) => ({ value: source.id, label: source.name })),
                  ]}
                  onChange={(value) =>
                    setFilter({ ...filter, sourceId: value === ANY ? undefined : value })
                  }
                />
                <Select
                  className="h-8 w-auto max-w-40"
                  aria-label={m.lineup_group_filter()}
                  value={groupValue}
                  options={[
                    { value: ANY, label: m.lineup_any_group() },
                    ...streams.groups.map((group) =>
                      group === ""
                        ? { value: NO_GROUP, label: m.lineup_no_group() }
                        : { value: group, label: group },
                    ),
                  ]}
                  onChange={(value) =>
                    setFilter({
                      ...filter,
                      group: value === ANY ? undefined : value === NO_GROUP ? "" : value,
                    })
                  }
                />
              </div>
            </div>
            {shown.length === 0 && !loading ? (
              <p className="flex-1 p-5 text-meta text-fg-2">
                {lineup.length === 0 ? m.channels_empty() : m.channels_none_match()}
              </p>
            ) : (
              <LineupList
                channels={shown}
                lineup={lineup}
                streams={streams}
                openId={openId}
                selected={selected}
                loading={loading}
                label={m.channels_heading()}
                onKey={onKey}
              />
            )}
            <div className="flex h-10 flex-none items-center gap-3 border-t border-line px-3 text-caption text-fg-3">
              <span className="flex items-center gap-1 max-md:hidden">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                {m.lineup_hint_next()}
              </span>
              <span className="flex items-center gap-1 max-md:hidden">
                <Kbd>H</Kbd>
                {m.lineup_hide()}
              </span>
              <span className="flex items-center gap-1 max-md:hidden">
                <Kbd>#</Kbd>
                {m.lineup_number_field()}
              </span>
              <span className="ml-auto tabular-nums">
                {m.channels_count({ count: counts.all })}
              </span>
            </div>
            {selectedIds.length === 0 ? null : (
              <BulkBar
                count={selectedIds.length}
                onClear={() => setSelected(new Set())}
                onHide={() => actions.setHidden(selectedIds, true)}
                onShow={() => actions.setHidden(selectedIds, false)}
                onMove={() => setMoving(selectedIds)}
                onFavourite={() =>
                  actions.setFavourite(
                    selectedIds,
                    !selectedIds.every((id) => byId.get(id)?.favourite === true),
                  )
                }
                onRemove={() => setRemoving(selectedIds)}
              />
            )}
          </div>
          <div className="min-h-0 overflow-y-auto max-md:hidden">
            {wide && detail !== null ? (
              detail
            ) : (
              <p className="grid h-full place-items-center p-8 text-center text-meta text-fg-3">
                {m.lineup_pick()}
              </p>
            )}
          </div>
        </div>
      </LoadingScope>
      {wide ? null : (
        <Sheet
          open={open !== undefined}
          onOpenChange={(next) => {
            if (!next) setOpenId(undefined);
          }}
          label={open?.name ?? m.channels_heading()}
          halfSnap={false}
        >
          {detail}
        </Sheet>
      )}
      {moving === undefined ? null : (
        <MoveDialog
          channels={inOrder(moving)}
          lineup={lineup}
          open
          onOpenChange={(next) => {
            if (!next) setMoving(undefined);
          }}
        />
      )}
      {removing === undefined ? null : (
        <RemoveDialog
          channels={inOrder(removing)}
          open
          onOpenChange={(next) => {
            if (!next) setRemoving(undefined);
          }}
          onRemoved={(ids) => {
            const gone = new Set(ids);
            setSelected(new Set([...selected].filter((id) => !gone.has(id))));
            if (openId !== undefined && gone.has(openId)) setOpenId(undefined);
          }}
        />
      )}
    </LineupActionsContext>
  );
}
