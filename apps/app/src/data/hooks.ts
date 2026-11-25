import { type QueryObserverResult, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiQueries } from "../api/queries.ts";
import { useApiRuntime } from "../session/session-context.ts";
import { buildGuide } from "./guide-data.ts";
import { channelNames, homeModel } from "./home.ts";
import { todoItems } from "./recording-text.ts";
import {
  DAY,
  dayKey,
  dayOf,
  daysAround,
  type GuideDay,
  guideDays,
  HOUR,
  loadedDays,
  requestWindow,
} from "@slipstream/domain";
import { householdZone } from "./zone.ts";

/** Query options bound to the signed-in profile's runtime. */
export const useApiQueries = () => {
  const runtime = useApiRuntime();
  return useMemo(() => apiQueries(runtime), [runtime]);
};

/** The home model from recordings, channels and saved positions. */
export const useHome = (now: number) => {
  const queries = useApiQueries();
  const recordings = useQuery(queries.recordings());
  const channels = useQuery(queries.channels());
  const positions = useQuery(queries.continueWatching());
  const model = useMemo(
    () => homeModel(recordings.data ?? [], channels.data ?? [], positions.data ?? [], now),
    [recordings.data, channels.data, positions.data, now],
  );
  return {
    model,
    /** The library, for what "Watch live" opens on a channel being recorded. */
    recordings: recordings.data ?? [],
    loading: recordings.isPending || channels.isPending,
    error: recordings.error ?? channels.error,
    retry: () => {
      void recordings.refetch();
      void channels.refetch();
    },
  };
};

/**
 * The days' answers in order, the first error and a retry of the failed ones: a `useQueries`
 * combine, so it changes only when a query's result does.
 */
const perDay = <A>(results: readonly QueryObserverResult<A>[]) => ({
  answers: results.map((result) => result.data),
  error: results.find((result) => result.error !== null)?.error ?? null,
  retry: () => {
    for (const result of results) if (result.error !== null) void result.refetch();
  },
});

/**
 * The guide's programmes loaded a household day at a time: the day in view (`focus`, a day key)
 * and its neighbours ask the server, one request per day; every day loaded once stays (TanStack
 * keeps it while its query sleeps), so scrolling back costs nothing. A day counts as loaded
 * when its entries and its repeat marks are both in ({@link loadedDays}).
 */
export const useGuideDays = (days: readonly GuideDay[], focus: string | undefined) => {
  const queries = useApiQueries();
  const wanted = new Set(daysAround(days, focus).map((day) => day.key));
  const programmes = useQueries({
    queries: days.map((day) => ({
      ...queries.guide(day.start, day.end),
      enabled: wanted.has(day.key),
    })),
    combine: perDay,
  });
  const repeats = useQueries({
    queries: days.map((day) => ({
      ...queries.guideRepeats(day.start, day.end),
      enabled: wanted.has(day.key),
    })),
    combine: perDay,
  });
  return useMemo(
    () => ({
      ...loadedDays(days, programmes.answers, repeats.answers),
      error: programmes.error ?? repeats.error,
      retry: () => {
        programmes.retry();
        repeats.retry();
      },
    }),
    [days, programmes, repeats],
  );
};

/**
 * The household's days a guide shows, from `pick` (the phone: from today; the TV: yesterday
 * too), recomputed when the household's date changes rather than on every clock tick, so the
 * days' query keys stay stable.
 */
export const useHouseholdDays = (
  now: number,
  pick: (now: number, zone: string) => readonly GuideDay[],
) => {
  const zone = householdZone();
  const today = dayKey(now, zone);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => pick(now, zone), [today, zone]);
  return { days, today };
};

/**
 * What both guides read for `days`: the channels, the programmes loaded a day at a time around
 * `focus` (a day key), and the recordings and conflicts that mark them. It stays loading until
 * the markers are in too, so a mark never arrives after a title is placed; live events refresh
 * it all.
 */
export const useGuideWindow = (days: readonly GuideDay[], focus: string) => {
  const queries = useApiQueries();
  const asked = requestWindow(days);
  const channels = useQuery(queries.channels());
  const loaded = useGuideDays(days, focus);
  const recordings = useQuery(queries.recordings());
  const conflicts = useQuery(queries.conflicts(asked.from, asked.to));
  return {
    channels: channels.data ?? [],
    programmes: loaded.programmes,
    repeats: loaded.repeats,
    /** The days not loaded yet: the grid draws skeleton cells in their stretch. */
    pending: loaded.pending,
    recordings: recordings.data ?? [],
    conflicts: conflicts.data ?? [],
    loading:
      channels.isPending || loaded.loaded.size === 0 || recordings.isPending || conflicts.isPending,
    error: channels.error ?? loaded.error ?? recordings.error,
    retry: () => {
      void channels.refetch();
      void recordings.refetch();
      void conflicts.refetch();
      loaded.retry();
    },
  };
};

/** The TV guide's days: yesterday too (late evening stays in reach after midnight). */
const tvGuideDays = (now: number, zone: string): readonly GuideDay[] => [
  dayOf(now - DAY, now, zone),
  ...guideDays(now, zone),
];

/**
 * The TV guide for the cursor: {@link useGuideWindow} over yesterday and the coming days,
 * built into the cursor's guide model (today until the cursor moves).
 */
export const useGuideData = (now: number, focus: string | undefined) => {
  const { days, today } = useHouseholdDays(now, tvGuideDays);
  const window = useGuideWindow(days, focus ?? today);
  const data = useMemo(
    () =>
      buildGuide(window.channels, window.programmes, {
        recordings: window.recordings,
        conflicts: window.conflicts,
        repeats: window.repeats,
      }),
    [window.channels, window.programmes, window.repeats, window.recordings, window.conflicts],
  );
  return { ...window, ...data };
};

/** How far conflicts are asked for: the rest of today and the two weeks after it. */
const CONFLICT_WINDOW_MS = 15 * DAY;

/**
 * The stretch "To do", Scheduled and the record sheets ask conflicts for: from the current hour,
 * {@link CONFLICT_WINDOW_MS} ahead. Fixed when the screen opens, so its query key stays stable;
 * live events refresh it.
 */
export const useConflictWindow = () =>
  useState(() => {
    const hour = Math.floor(Date.now() / HOUR) * HOUR;
    return { from: hour, to: hour + CONFLICT_WINDOW_MS };
  })[0];

/**
 * The "To do" row of Home: this profile's failed and incomplete recordings (everyone's for an
 * admin), and conflicts for an admin.
 */
export const useTodo = (now: number) => {
  const queries = useApiQueries();
  const range = useConflictWindow();
  const me = useQuery(queries.me());
  const recordings = useQuery(queries.recordings());
  const channels = useQuery(queries.channels());
  const admin = me.data?.role === "admin";
  const conflicts = useQuery({ ...queries.conflicts(range.from, range.to), enabled: admin });
  return {
    items: todoItems({
      me: me.data?.id,
      admin,
      recordings: recordings.data ?? [],
      conflicts: conflicts.data ?? [],
      now,
    }),
    entries: recordings.data ?? [],
    names: channelNames(channels.data ?? []),
  };
};
