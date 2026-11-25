import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { channelMark, isPlayable, type RuleId } from "@slipstream/domain";
import {
  useCreateSeriesCollection,
  useDeclineOffer,
  useUndoSeriesCollection,
} from "~/api/mutations.ts";
import { dayPill, m, pathLabels } from "@slipstream/i18n";
import { announce } from "~/ui/announce-store.ts";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import { Badge, Chip, SearchField, Segmented } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, GuideIcon, RulesIcon } from "~/ui/icons.ts";
import { Section, Wrap } from "~/ui/page.tsx";
import { SectionedGrid } from "~/ui/sectioned-grid.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { placeholderList, rememberedList } from "~/ui/skeleton-state.ts";
import { EmptyState, ErrorState } from "~/ui/states.tsx";
import { useNow } from "~/ui/use-now.ts";
import { cn } from "~/ui/utils.ts";
import { tileGrid } from "./grids.ts";
import { libraryGroups, type LibraryGroup } from "./groups.ts";
import {
  filterRecordings,
  groupRecordings,
  type LibraryContext,
  type LibraryFilter,
  type LibraryView,
} from "./library.ts";
import { type SeriesOffer, seriesOffers } from "./offers.ts";
import { type LibraryData, useLibraryData } from "./queries.ts";
import { toast } from "~/ui/toast-manager.ts";
import { RecordingCard } from "./recording-card.tsx";
import { RecordingsHeader } from "./recordings-header.tsx";

/** A collection or show as a stacked tile: count, new count, where the grouping comes from. */
function GroupTile({ group, data }: { group: LibraryGroup; data: LibraryData }) {
  const first = group.entries[0];
  const channel = first ? data.channel(first.channelId) : undefined;
  return (
    <Link
      to="/recordings/c/$group/{-$season}"
      params={{ group: group.key }}
      className="card"
      aria-label={group.name}
    >
      <span className="card-media relative pt-2.5 before:absolute before:inset-x-[8%] before:top-1 before:h-5 before:rounded-t-[10px] before:bg-fg-4 before:opacity-35 after:absolute after:inset-x-[4%] after:top-1.75 after:h-5 after:rounded-t-[10px] after:bg-fg-4 after:opacity-55">
        <Artwork
          className="relative z-1"
          noMark
          subject={{
            title: group.name,
            categories: first?.categories ?? [],
            ...(channel ? { channel: { mark: channelMark(channel.name) } } : {}),
          }}
          title={{ kicker: "", main: group.name }}
        />
      </span>
      <span className="card-meta">
        <span className="card-title">
          <Sk placeholder={group.name}>{group.name}</Sk>
        </span>
        <span className="card-sub">
          <Sk>
            {m.library_tile_count({ count: group.entries.length })}
            {group.newCount > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-brand-fg">
                  {m.library_tile_new({ count: group.newCount })}
                </span>
              </>
            ) : null}
          </Sk>
        </span>
      </span>
    </Link>
  );
}

/** The box of the series offer card. */
const offerBox =
  "mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 rounded-lg bg-brand-soft px-4 py-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand)_35%,transparent)] sm:grid-cols-[auto_minmax(0,1fr)_auto]";

/**
 * The series offer (recording model §3.3): "“Live F1” is in 3 places. Group it?" with No thanks
 * (never offered again) and Group them (a collection that follows it, with Undo).
 */
function SeriesOfferCard({ item, onDone }: { item: SeriesOffer; onDone: () => void }) {
  const group = useCreateSeriesCollection();
  const decline = useDeclineOffer();
  const undo = useUndoSeriesCollection();
  const { rule, offer } = item;
  return (
    <div className={offerBox} data-offer={rule.id}>
      <span className="grid size-10 place-items-center rounded-md bg-brand text-on-brand">
        <Icon icon={RulesIcon} />
      </span>
      <div className="min-w-0 text-[13.5px]">
        {m.offer_title({ name: rule.name, count: offer.groups })}
      </div>
      <div className="col-span-2 flex gap-2 sm:col-span-1">
        <Button
          size="sm"
          variant="ghost"
          busy={decline.isPending}
          onClick={() =>
            decline.mutate(rule.id, {
              onSuccess: onDone,
              onError: () => toast({ title: m.library_action_failed(), type: "error" }),
            })
          }
        >
          {m.offer_decline()}
        </Button>
        <Button
          size="sm"
          variant="primary"
          busy={group.isPending}
          onClick={() =>
            group.mutate(
              { ruleId: rule.id, request: { name: offer.name, layout: offer.layout } },
              {
                onSuccess: () => {
                  onDone();
                  const title = m.offer_done({ name: offer.name });
                  announce(title);
                  toast({ title, alreadyAnnounced: true, undo: () => undo.mutate(rule.id) });
                },
                onError: () => toast({ title: m.library_action_failed(), type: "error" }),
              },
            )
          }
        >
          {m.offer_group()}
        </Button>
      </div>
    </div>
  );
}

const placeholderGroup = (index: number): LibraryGroup => ({
  key: `placeholder-${index}`,
  name: "Collection name",
  source: "collection",
  collection: undefined,
  entries: [],
  newCount: 0,
});

/** Library › Collections & shows (SPEC §7.5): Recording now, Collections, Shows & films. */
function CollectionsView({ data, shown }: { data: LibraryData; shown: LibraryData["recordings"] }) {
  // The offers answered on this page (declined or grouped), by rule, until the answers refetch.
  const [answered, setAnswered] = useState<ReadonlySet<RuleId>>(new Set());
  const groups = useMemo(
    () => libraryGroups(shown, data.collections, pathLabels()),
    [shown, data.collections],
  );
  // Drawn from the last answers while loading when this browser kept all of them (SPEC §6.2).
  const known = data.collectionsKnown;
  const collections = rememberedList(
    "library.collections",
    known ? groups.filter((group) => group.collection !== undefined) : undefined,
    4,
    placeholderGroup,
  );
  const shows = rememberedList(
    "library.shows",
    known ? groups.filter((group) => group.collection === undefined) : undefined,
    4,
    placeholderGroup,
  );
  // A series recording whose recordings scatter offers a collection, only to people who may
  // create collections. Days and groups are the household's, known once data has loaded.
  const { isAdmin, timeZone, rules, recordings, collections: all, channel } = data;
  const offers = useMemo(
    () =>
      isAdmin && timeZone !== undefined
        ? seriesOffers(rules, recordings, all, {
            timeZone,
            channelName: (id) => channel(id)?.name,
          })
        : [],
    [isAdmin, timeZone, rules, recordings, all, channel],
  );
  const offer = data.isAdmin ? offers.find((item) => !answered.has(item.rule.id)) : undefined;
  return (
    <>
      {collections.length > 0 || data.isAdmin ? (
        <Section>
          <div className="section-head">
            <h2 className="section-head-title type-h2">
              <Sk>{m.library_collections()}</Sk>
            </h2>
            {data.isAdmin ? (
              <Button
                icon={<Icon icon={AddIcon} />}
                nativeButton={false}
                render={<Link to="/recordings/collections/new" />}
              >
                {m.library_new_collection()}
              </Button>
            ) : null}
          </div>
          <div className={tileGrid}>
            {collections.map((group) => (
              <GroupTile key={group.key} group={group} data={data} />
            ))}
          </div>
          {offer === undefined ? null : (
            <SeriesOfferCard
              key={offer.rule.id}
              item={offer}
              onDone={() => setAnswered((before) => new Set([...before, offer.rule.id]))}
            />
          )}
        </Section>
      ) : null}
      {shows.length > 0 ? (
        <Section title={<Sk>{m.library_shows()}</Sk>}>
          <div className={tileGrid}>
            {shows.map((group) => (
              <GroupTile key={group.key} group={group} data={data} />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/**
 * Recordings › Library (SPEC §8.4): toolbar (search, group-by, All / Unwatched / Mine), then the
 * view. Filters live in the URL so Back restores them.
 */
export function LibraryPage({
  view,
  filter,
  query,
}: {
  view: LibraryView;
  filter: LibraryFilter;
  query: string;
}) {
  const data = useLibraryData();
  const now = useNow(30_000);
  const loading = data.loading;
  const navigate = useNavigate();
  const setSearch = (next: { group?: LibraryView; filter?: LibraryFilter; q?: string }) => {
    void navigate({
      to: "/recordings",
      search: (prev) => {
        const merged = { ...prev, ...next };
        return {
          ...(merged.group && merged.group !== "collections" ? { group: merged.group } : {}),
          ...(merged.filter && merged.filter !== "all" ? { filter: merged.filter } : {}),
          ...(merged.q ? { q: merged.q } : {}),
        };
      },
      replace: true,
    });
  };
  const { recordings, collections, channel, timeZone, me } = data;
  // The library can be long: its lists are derived once per answer, filter and clock tick, not
  // on every render (typing in search, a hover elsewhere).
  const context = useMemo<LibraryContext>(
    () => ({
      labels: pathLabels(),
      channels: channelsOf(recordings, channel),
      collections,
      day: (epochMs: number) => dayPill(epochMs, now, timeZone),
      timeZone,
    }),
    [recordings, channel, collections, now, timeZone],
  );
  const library = useMemo(() => recordings.filter(isPlayable), [recordings]);
  const shown = useMemo(
    () =>
      me === undefined ? library : filterRecordings(library, { filter, query, user: me, context }),
    [library, me, filter, query, context],
  );
  const running = useMemo(() => shown.filter((entry) => entry.state === "recording"), [shown]);
  const showRunning = filter === "all" && query === "" && running.length > 0;

  // A search lists dates, not collections.
  const flat = view === "collections" && query !== "" ? "date" : view;
  const grouped = useMemo(
    () =>
      flat === "collections"
        ? []
        : groupRecordings(
            shown.filter((entry) => entry.state !== "recording" || !showRunning),
            flat,
            context,
          ),
    [flat, shown, showRunning, context],
  );
  let body;
  if (data.error) {
    body = (
      <ErrorState
        title={m.library_error_title()}
        actions={<Button onClick={data.refetch}>{m.action_try_again()}</Button>}
      />
    );
  } else if (!data.loading && library.length === 0) {
    body = (
      <EmptyState
        title={m.recordings_empty()}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="primary"
              icon={<Icon icon={GuideIcon} />}
              nativeButton={false}
              render={<Link to="/guide" />}
            >
              {m.action_open_guide()}
            </Button>
            <Button
              icon={<Icon icon={RulesIcon} />}
              nativeButton={false}
              render={<Link to="/series/new" />}
            >
              {m.series_new()}
            </Button>
          </div>
        }
      />
    );
  } else if (!data.loading && shown.length === 0) {
    body = (
      <EmptyState
        title={m.library_no_match_title({
          query:
            query ||
            (filter === "mine" ? m.recordings_filter_mine() : m.recordings_filter_unwatched()),
        })}
        action={
          <Button onClick={() => setSearch({ filter: "all", q: "" })}>
            {m.library_clear_filters()}
          </Button>
        }
      />
    );
  } else if (
    data.loading &&
    (data.recordings.length === 0 || (flat === "collections" && !data.collectionsKnown))
  ) {
    // Cold, with no kept answer: which sections come (Recording now, Collections, Shows & films)
    // and how many tiles each holds is unknown (kept recordings alone would draw collection
    // members as shows). One placeholder section stands in and is replaced as a whole.
    body = (
      <Section key="cold" title={<Sk chars={14} />}>
        <div className={tileGrid}>
          {placeholderList(undefined, 4, placeholderGroup).map((group) => (
            <GroupTile key={group.key} group={group} data={data} />
          ))}
        </div>
      </Section>
    );
  } else {
    body = (
      <>
        {showRunning ? (
          <Section
            title={
              <>
                <Sk>{m.recordings_recording_now()}</Sk>
                <Badge tone="rec" className="sk">
                  {m.library_count({ count: running.length })}
                </Badge>
              </>
            }
          >
            <div className={cn(tileGrid, "max-[420px]:grid-cols-1")}>
              {running.map((entry) => (
                <RecordingCard key={entry.id} entry={entry} data={data} now={now} />
              ))}
            </div>
          </Section>
        ) : null}
        {flat === "collections" ? (
          <CollectionsView data={data} shown={shown} />
        ) : (
          <SectionedGrid
            sections={grouped.map((group) => ({
              key: group.key,
              title: (
                <>
                  <Sk>{group.title}</Sk>
                  <span className="text-sm font-medium text-fg-3">
                    {m.library_count({ count: group.items.length })}
                  </span>
                </>
              ),
              items: group.items.toReversed(),
            }))}
            grid={tileGrid}
            itemKey={(entry) => entry.id}
            renderItem={(entry) => <RecordingCard entry={entry} data={data} now={now} />}
          />
        )}
      </>
    );
  }

  return (
    <Wrap>
      <RecordingsHeader data={data} />
      <LoadingScope loading={loading}>
        {library.length === 0 && !data.loading ? null : (
          <div
            role="toolbar"
            aria-label={m.recordings_search()}
            className="mb-6 flex flex-wrap items-center gap-2.5 short:scroller short:mb-3.5 short:flex-nowrap short:p-0.5 short:*:flex-none"
          >
            <SearchField
              className="flex-[1_1_220px] sm:max-w-90 short:flex-[0_0_200px]"
              placeholder={m.recordings_search()}
              aria-label={m.recordings_search()}
              autoComplete="off"
              value={query}
              onChange={(event) => setSearch({ q: event.currentTarget.value })}
            />
            <Segmented<LibraryView>
              label={m.recordings_view_label()}
              value={view}
              onChange={(group) => setSearch({ group })}
              segments={[
                {
                  value: "collections",
                  label: (
                    <>
                      <span className="max-sm:hidden">{m.recordings_group_collections()}</span>
                      <span className="sm:hidden">{m.library_group_shows_short()}</span>
                    </>
                  ),
                },
                { value: "channel", label: m.recordings_group_channel() },
                { value: "date", label: m.recordings_group_date() },
              ]}
            />
            <div
              role="group"
              aria-label={m.recordings_filter_label()}
              className="flex gap-2 max-sm:scroller max-sm:flex-[1_1_100%] short:order-first short:flex-none"
            >
              {(["all", "unwatched", "mine"] as const).map((value) => (
                <Chip
                  key={value}
                  pressed={filter === value}
                  onPressedChange={() => setSearch({ filter: value })}
                >
                  {value === "all"
                    ? m.recordings_filter_all()
                    : value === "unwatched"
                      ? m.recordings_filter_unwatched()
                      : m.recordings_filter_mine()}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {body}
      </LoadingScope>
    </Wrap>
  );
}

/** Every channel the recordings mention, for search and the By channel view. */
const channelsOf = (recordings: LibraryData["recordings"], channel: LibraryData["channel"]) =>
  [...new Set(recordings.map((entry) => entry.channelId))].flatMap((id) => {
    const found = channel(id);
    return found ? [found] : [];
  });
