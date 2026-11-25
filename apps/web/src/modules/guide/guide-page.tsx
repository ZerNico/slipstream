import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type Channel,
  ChannelId,
  epochMs,
  type GuideEntry,
  loadedDays,
  programmeMarks,
} from "@slipstream/domain";
import { useHouseholdTimeZone } from "~/api/hooks.ts";
import { keys } from "~/api/queries.ts";
import { formatClock } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { isTyping } from "~/shell/shortcuts.ts";
import { Chip, Segmented } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { ClockIcon, GridIcon, ListIcon, RefreshIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { placeholderList, useRememberedCount } from "~/ui/skeleton-state.ts";
import { EmptyState, ErrorState } from "~/ui/states.tsx";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";
import { useNow } from "~/ui/use-now.ts";
import { useScrollEdges } from "~/ui/use-scroll-edges.ts";
import { cn } from "~/ui/utils.ts";
import { ChannelList } from "./channel-list.tsx";
import { DaySwitcher, FilterMenu } from "./guide-menus.tsx";
import { categoryLabel } from "./labels.ts";
import {
  channelColumnWidth,
  gridWindow,
  guideCategories,
  visibleChannels,
  guideDays,
  narrowChannelColumn,
  pendingGuideDays,
  type GuideCategory,
  type GuideDay,
  pickCategory,
  pickDay,
  pickSlot,
  pixelsPerMinute,
  primeTime,
  rowsByChannel,
  type GuideAt,
  slotTime,
  timeOnDay,
} from "./model.ts";
import { useGuideData } from "./queries.ts";
import { SlotChips } from "./slot-chips.tsx";
import { type TimelineGridHandle, TimelineGrid } from "./timeline-grid.tsx";

/** The guide's search params (validated by the route). */
export interface GuideSearch {
  readonly view?: "timeline" | "channels";
  readonly day?: string;
  readonly cat?: string;
  readonly at?: string;
}

/** A change to the search params; `undefined` removes a key. */
export interface GuideSearchPatch {
  readonly view?: GuideView | undefined;
  readonly day?: string | undefined;
  readonly cat?: string | undefined;
  readonly at?: string | undefined;
}

/** The view a person gets without choosing: Timeline from 768 px and in short landscape. */
export type GuideView = "timeline" | "channels";

/** How many rows to draw before the channel list arrives, without a previous answer. */
const defaultRows = 8;
/** The most rows a remembered channel count may ask the skeleton for (a large playlist). */
const maxGuideRows = 1000;

/**
 * The view switch's words: under 360 px the icons alone (the words stay for screen readers), so
 * the Filter chip and the switch fit one row at 320 px in every language.
 */
const segmentWord = "max-[359px]:sr-only";

/** No days: what the timeline marks as loading while the whole page is its skeleton. */
const noDays: readonly GuideDay[] = [];

/** No programmes: one array, so what is derived from it holds still while the guide loads. */
const noProgrammes: readonly GuideEntry[] = [];

const placeholderChannel = (index: number): Channel => ({
  id: ChannelId.make(`placeholder-${index}`),
  name: " ",
  favourite: false,
  hidden: false,
});

/**
 * The guide (SPEC §8.2): the header with Now / 20:15 and the view switch, the day switcher and
 * the categories (a Filter chip under 768 px, one header row in short landscape), then the
 * Timeline grid (one timeline across every day of guide data, on phones too) or the Channels
 * list. Loading draws the same layout; errors and empty guides keep the header.
 */
export function GuidePage({
  search,
  onSearch,
}: {
  search: GuideSearch;
  onSearch: (patch: GuideSearchPatch) => void;
}) {
  const now = useNow(30_000);
  const overlay = useOverlay();
  const tablet = useMediaQuery(media.tablet);
  const desktop = useMediaQuery(media.desktop);
  const short = useMediaQuery(media.shortLandscape);
  const grid = useRef<TimelineGridHandle | null>(null);
  const { ref: categoryScroller, edges: categoryEdges } = useScrollEdges<HTMLDivElement>();

  const client = useQueryClient();
  const timeZone = useHouseholdTimeZone();
  // Days are household days. Until the zone is known (a first visit) the page is its skeleton on
  // stand-in days: nothing day-bound is fetched, named or written to the URL.
  const pending = timeZone === undefined;
  const days = useMemo(
    () => (timeZone === undefined ? pendingGuideDays(now) : guideDays(now, timeZone)),
    [now, timeZone],
  );
  const day = pickDay(days, search.day);
  const category = pickCategory(search.cat);
  const slot = pickSlot(search.at, day);
  const view: GuideView = search.view ?? (tablet || short ? "timeline" : "channels");
  const gridView = view === "timeline";
  // The day the timeline has in view (it scrolls across days); the list shows the URL's day.
  const [inView, setInView] = useState<string | undefined>(undefined);
  const onVisibleDay = useCallback((next: GuideDay) => setInView(next.key), []);
  const shownDay = gridView ? (days.find((candidate) => candidate.key === inView) ?? day) : day;

  // The guide loads by day around the day the timeline has in view, or the list's day.
  const focus = gridView ? (inView ?? day.key) : day.key;
  const { channels, extent, recordings, conflicts, programmes, repeats } = useGuideData(
    days,
    focus,
    !pending,
  );
  // The loaded days as one guide; a day waits for its repeat marks too (see `loadedDays`).
  const guide = useMemo(
    () => loadedDays(days, programmes.byDay, repeats.byDay),
    [days, programmes.byDay, repeats.byDay],
  );
  // The page is its skeleton until the first day is in; later days load behind their own
  // placeholders (the timeline's quiet blocks, the list's skeleton rows).
  const loading =
    pending ||
    channels.isPending ||
    extent.isPending ||
    recordings.isPending ||
    conflicts.isPending ||
    guide.loaded.size === 0;
  const dayLoaded = guide.loaded.has(day.key);
  // A day waits for its programmes and its repeat marks: either failing is the guide failing,
  // never a skeleton that stays.
  const failure = channels.error ?? extent.error ?? programmes.error ?? repeats.error;
  // The derived rows are kept between renders (a sheet opening, the day in view changing while
  // scrolling) and change when a day's answer arrives. The grid places the cells it draws.
  const merged = guide.programmes;
  const channelsPending = channels.isPending;
  const listed = useMemo(() => visibleChannels(channels.data ?? []), [channels.data]);
  const listedCount = channelsPending || listed.length === 0 ? undefined : listed.length;
  // The channel count of the previous visit, so the skeleton draws exactly that many rows.
  const expectedRows = useRememberedCount("guide-rows", listedCount, defaultRows, maxGuideRows);
  const shown = useMemo(
    () => placeholderList(channelsPending ? undefined : listed, expectedRows, placeholderChannel),
    [channelsPending, listed, expectedRows],
  );
  // No cell is placed before its marker is known: a skeleton cell whose marker arrived later
  // would move its title bar by the marker's width.
  const placed = loading ? noProgrammes : merged;
  const rows = useMemo(() => rowsByChannel(placed), [placed]);
  const marks = useMemo(
    () => programmeMarks(recordings.data ?? [], conflicts.data ?? [], merged, guide.repeats),
    [recordings.data, conflicts.data, merged, guide.repeats],
  );
  const onToday = day.offset === 0;
  const dataEnd = extent.data?.end === undefined ? undefined : epochMs(extent.data.end);
  const range = useMemo(() => gridWindow(days, dataEnd), [days, dataEnd]);
  // The days whose programmes are not in yet: the timeline draws quiet blocks in their place.
  const pendingDays = loading ? noDays : guide.pending;
  const ppm = pixelsPerMinute(desktop);
  const at = slotTime(slot, day, now);
  const gridRows = useMemo(
    () =>
      gridView
        ? shown.map((channel) => ({ channel, programmes: rows.get(channel.id) ?? noProgrammes }))
        : [],
    [gridView, shown, rows],
  );
  const listRows = useMemo(
    () => shown.map((channel) => ({ channel, row: rows.get(channel.id) ?? [] })),
    [shown, rows],
  );

  // The overlay changes with every URL; the rows' callbacks read it when they run, so opening
  // a sheet does not hand every row a new callback (and redraw eight days of cells).
  const overlayNow = useRef(overlay);
  useLayoutEffect(() => {
    overlayNow.current = overlay;
  });
  const open = useCallback(
    (programme: GuideEntry) =>
      overlayNow.current.open({ kind: "sheet", name: "prog", arg: programme.id }),
    [],
  );
  const watch = useCallback(
    (recording: string) => overlayNow.current.open({ kind: "choice", name: recording }),
    [],
  );
  const jumpNow = () => {
    if (!onToday) onSearch({ day: undefined });
    grid.current?.focusNow();
  };
  const jumpPrime = () => grid.current?.scrollToTime(primeTime(shownDay), true);

  // N jumps to now, P to prime time, while the grid shows and nothing else has the keys.
  useEffect(() => {
    if (!gridView) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (overlay.current !== null) return;
      const key = event.key.toLowerCase();
      if (key === "n") grid.current?.focusNow();
      else if (key === "p") grid.current?.scrollToTime(primeTime(shownDay), true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // "Skip to the guide" lands on the grid's roving cell, not on <main> (SPEC §8.2, §10).
  useEffect(() => {
    if (!gridView) return;
    const main = document.getElementById("main");
    const onFocus = (event: FocusEvent) => {
      if (event.target === main) grid.current?.focusRoving();
    };
    main?.addEventListener("focus", onFocus);
    return () => main?.removeEventListener("focus", onFocus);
  }, [gridView, grid]);

  const setDay = (next: GuideDay) =>
    onSearch({ day: next.offset === 0 ? undefined : next.key, at: undefined });
  // The timeline moves to the same time of day on the picked day; the list switches its day.
  const goToDay = (next: GuideDay) => (gridView ? grid.current?.showDay(next) : setDay(next));
  const setCategory = (next: GuideCategory) => onSearch({ cat: next === "all" ? undefined : next });
  const setSlot = (next: GuideAt) =>
    onSearch({ at: next === pickSlot(undefined, day) ? undefined : next });

  // No guide at all: no channels, or no programme from today on. The list's day alone can lie
  // past where the data ends.
  const noGuide = listed.length === 0 || dataEnd === undefined || dataEnd <= (days[0]?.start ?? 0);
  const afterData = !gridView && dataEnd !== undefined && day.start >= dataEnd;
  const empty = !loading && failure === null && (noGuide || afterData);

  const content = () => {
    if (failure !== null) {
      return (
        <ErrorState
          title={m.guide_error_title()}
          actions={
            <Button
              icon={<Icon icon={RefreshIcon} />}
              onClick={() => {
                void channels.refetch();
                void client.refetchQueries({ queryKey: keys.guide, type: "active" });
              }}
            >
              {m.action_try_again()}
            </Button>
          }
        />
      );
    }
    if (empty) {
      return (
        <EmptyState
          title={noGuide ? m.guide_empty() : m.guide_day_empty()}
          action={
            noGuide ? (
              <Button
                nativeButton={false}
                render={<Link to="/settings/$section" params={{ section: "sources" }} />}
              >
                {m.settings_section_sources()}
              </Button>
            ) : undefined
          }
        />
      );
    }
    if (gridView) {
      return (
        <TimelineGrid
          ref={grid}
          rows={gridRows}
          marks={marks}
          pendingDays={pendingDays}
          window={range}
          days={days}
          onVisibleDay={onVisibleDay}
          now={now}
          ppm={ppm}
          channelWidth={channelColumnWidth(desktop, short)}
          compact={narrowChannelColumn(desktop, short)}
          category={category}
          initialTime={onToday ? now : timeOnDay(day, 19, 0)}
          onOpen={open}
        />
      );
    }
    return (
      <ChannelList
        rows={listRows}
        at={at}
        isNow={slot === "now"}
        now={now}
        marks={marks}
        category={category}
        onOpen={open}
        onWatch={watch}
      />
    );
  };

  const slotChips = (label: string) => (
    <LoadingScope loading={pending} className="contents">
      <SlotChips day={day} now={now} value={slot} label={label} onChange={setSlot} />
    </LoadingScope>
  );

  return (
    <Wrap
      className={cn(
        gridView &&
          "flex h-[calc(100dvh-var(--nav-h)-var(--safe-t)-var(--tab-h)-var(--mini-h)-var(--safe-b)-24px)] flex-col md:h-[calc(100dvh-var(--nav-h)-var(--safe-t)-32px-var(--mini-h)-var(--safe-b))] short:mb-[calc(-24px-var(--safe-b))] short:h-[calc(100dvh-var(--nav-h)-var(--safe-t))]! md:short:mb-[calc(-32px-var(--safe-b))]",
      )}
    >
      <header className="page-head flex-none short:flex-nowrap! short:items-center!">
        <h1 className="page-head-title type-h1 short:text-[24px]">{m.nav_guide()}</h1>
        <div className="flex min-w-0 items-center gap-2.5 short:flex-nowrap">
          {/* Prime time and the day are household times: skeletons until the zone is known. */}
          <LoadingScope loading={pending} className="contents">
            {gridView && tablet ? (
              <>
                <Button icon={<Icon icon={ClockIcon} size={16} />} onClick={jumpNow}>
                  {m.guide_jump_now()}
                </Button>
                <Button
                  aria-label={m.guide_jump_prime_label({ time: new Date(primeTime(day)) })}
                  onClick={jumpPrime}
                >
                  <Sk>{formatClock(primeTime(day))}</Sk>
                </Button>
              </>
            ) : null}
            {short ? <DaySwitcher days={days} day={shownDay} onDay={goToDay} compact /> : null}
            {!tablet || short ? (
              <FilterMenu
                category={category}
                onCategory={setCategory}
                {...(short && view === "channels"
                  ? { slots: { day, now, value: slot, onChange: setSlot } }
                  : {})}
              />
            ) : null}
          </LoadingScope>
          <Segmented
            label={m.guide_view_label()}
            value={view}
            onChange={(next) =>
              onSearch({
                view: next === (tablet || short ? "timeline" : "channels") ? undefined : next,
              })
            }
            segments={[
              {
                value: "timeline",
                label: (
                  <>
                    <Icon icon={GridIcon} size={16} />
                    <span className={segmentWord}>{m.guide_view_timeline()}</span>
                  </>
                ),
              },
              {
                value: "channels",
                label: (
                  <>
                    <Icon icon={ListIcon} size={16} />
                    <span className={segmentWord}>{m.guide_view_channels()}</span>
                  </>
                ),
              },
            ]}
          />
        </div>
      </header>

      {short ? null : (
        <LoadingScope
          loading={pending}
          className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2.5 pb-3.5"
        >
          <div className="flex min-w-0 flex-[1_1_auto] items-center">
            <DaySwitcher days={days} day={shownDay} onDay={goToDay} />
          </div>
          {tablet ? (
            <div
              ref={categoryScroller}
              className="scroller scroller-fade min-w-0 flex-[0_1_auto] gap-2"
              {...categoryEdges}
              role="group"
              aria-label={m.guide_categories_label()}
            >
              {guideCategories.map((candidate) => (
                <Chip
                  key={candidate}
                  pressed={candidate === category}
                  onPressedChange={() => setCategory(candidate)}
                >
                  {categoryLabel(candidate)}
                </Chip>
              ))}
            </div>
          ) : null}
        </LoadingScope>
      )}

      {!short && view === "channels" && !empty && failure === null ? (
        <div className="mb-3 flex flex-none items-center gap-2">
          {slotChips(m.guide_slots_label())}
        </div>
      ) : null}

      <LoadingScope
        // The list shows one day: skeleton rows while that day loads, as on the first visit.
        loading={(loading || (!gridView && !dayLoaded)) && failure === null}
        className={cn(gridView && "flex min-h-0 flex-1 flex-col")}
      >
        {content()}
      </LoadingScope>
    </Wrap>
  );
}
