import type { SourceGroup, SourceStreamEntry } from "@slipstream/api";
import {
  addPlan,
  defaultPicked,
  isLanguageGroup,
  isPickable,
  pickedIds,
  pickerGroupKey,
  pickerKeys,
  pickerRows,
  setPicked,
  shownStreams,
  type SourceId,
  type TickState,
  tickState,
} from "@slipstream/domain";
import { getLocale } from "@slipstream/i18n";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { Href } from "expo-router";
import { Effect } from "effect";
import { useDeferredValue, useMemo, useState } from "react";
import { Api } from "../../../api/client.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useApiRuntime } from "../../../session/session-context.ts";

/* The stream picker's state on a phone: the domain's picker rules over the source's catalogue. */

/** Where a source's streams are picked, inside Settings; `new` opens on its new streams. */
export const streamPickerHref = (id: string, show?: "new"): Href => ({
  pathname: "/settings/sources/pick/[id]",
  params: show === undefined ? { id } : { id, show },
});

/** Which streams the picker lists: all, the ticked ones, or the new ones. */
export type PickerShow = "all" | "picked" | "new";

/** The most streams one catalogue call returns. */
const page = 5000;

/** The picker's reads; under `sources`, so a source change refetches them. */
export const pickerQueryKeys = {
  catalogue: (id: string) => ["sources", "catalogue", id] as const,
  groups: (id: string) => ["sources", "groups", id] as const,
  newCount: (id: string) => ["sources", "new", id] as const,
};

/** Every stream of a source, in pages of 5,000 until all are in. */
const allStreams = (sourceId: SourceId) =>
  Effect.gen(function* () {
    const api = yield* Api;
    const streams: SourceStreamEntry[] = [];
    for (;;) {
      const answer = yield* api.sources.catalogue({
        params: { sourceId },
        query: { offset: streams.length, limit: page },
      });
      streams.push(...answer.streams);
      if (answer.streams.length === 0 || streams.length >= answer.total) return streams;
    }
  });

/** The picker's three reads, bound to the signed-in runtime. */
export const usePickerQueries = () => {
  const runtime = useApiRuntime();
  return useMemo(
    () => ({
      catalogue: (sourceId: SourceId) =>
        queryOptions({
          queryKey: pickerQueryKeys.catalogue(sourceId),
          queryFn: ({ signal }) => runtime.runPromise(allStreams(sourceId), { signal }),
        }),
      groups: (sourceId: SourceId) =>
        queryOptions({
          queryKey: pickerQueryKeys.groups(sourceId),
          queryFn: ({ signal }) =>
            runtime.runPromise(
              Effect.flatMap(Api, (api) => api.sources.groups({ params: { sourceId } })),
              { signal },
            ),
        }),
      /** How many streams are new since the source was last reviewed. */
      newCount: (sourceId: SourceId) =>
        queryOptions({
          queryKey: pickerQueryKeys.newCount(sourceId),
          queryFn: ({ signal }) =>
            runtime.runPromise(
              Effect.map(
                Effect.flatMap(Api, (api) =>
                  api.sources.catalogue({
                    params: { sourceId },
                    query: { filter: "new", limit: 0 },
                  }),
                ),
                (answer) => answer.total,
              ),
              { signal },
            ),
        }),
    }),
    [runtime],
  );
};

const noStreams: readonly SourceStreamEntry[] = [];
const noGroups: readonly SourceGroup[] = [];
const nothing: ReadonlySet<string> = new Set();

/**
 * What the phone's picker shows and does: groups first (their counts), every stream once loaded,
 * the ticks (the reader's language groups of a fresh playlist), open groups, the search and
 * "Selected", and what Add makes.
 */
export const useStreamPicker = (sourceId: SourceId, initialShow: PickerShow = "all") => {
  const queries = usePickerQueries();
  const groups = useQuery(queries.groups(sourceId));
  const catalogue = useQuery(queries.catalogue(sourceId));
  const streams = catalogue.data ?? noStreams;
  const groupList = groups.data ?? noGroups;
  const loaded = catalogue.data !== undefined;
  const language = getLocale();
  // Fresh until someone has reviewed the source: streams that joined channels by guide id on
  // their own don't count as a choice.
  const sources = useQuery(useApiQueries().sources());
  const source = sources.data?.find((candidate) => candidate.id === sourceId);
  const fresh = source === undefined ? undefined : source.reviewedAt === undefined;
  const initial = useMemo(
    () => (loaded && fresh !== undefined ? defaultPicked(streams, language, fresh) : undefined),
    [loaded, streams, language, fresh],
  );
  const [chosen, setChosen] = useState<ReadonlySet<string> | undefined>(undefined);
  const picked = chosen ?? initial ?? nothing;
  const [open, setOpen] = useState<ReadonlySet<string>>(nothing);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<PickerShow>(initialShow);
  const onlyPicked = show === "picked";
  const onlyNew = show === "new";
  const deferredSearch = useDeferredValue(search);

  const keys = useMemo(() => pickerKeys(streams), [streams]);
  const byGroup = useMemo(() => {
    const map = new Map<string, SourceStreamEntry[]>();
    for (const stream of streams) {
      const key = pickerGroupKey(stream.group);
      const list = map.get(key);
      if (list === undefined) map.set(key, [stream]);
      else list.push(stream);
    }
    return map;
  }, [streams]);
  const rows = useMemo(
    () =>
      pickerRows(groupList, streams, picked, open, {
        search: deferredSearch,
        onlyPicked,
        onlyNew,
      }),
    [groupList, streams, picked, open, deferredSearch, onlyPicked, onlyNew],
  );
  const plan = useMemo(() => addPlan(streams, picked, keys), [streams, picked, keys]);

  const languageGroup = (group: SourceGroup) =>
    fresh && group.name !== undefined && isLanguageGroup(group.name, language);
  const total = loaded
    ? streams.filter(isPickable).length
    : groupList.reduce((sum, group) => sum + group.streams - group.added, 0);
  const selected = loaded
    ? picked.size
    : groupList
        .filter(languageGroup)
        .reduce((sum, group) => sum + group.streams - group.added - group.ignored, 0);

  const streamsOf = (group: SourceGroup) => byGroup.get(pickerGroupKey(group.name)) ?? noStreams;
  return {
    loading: groups.isPending,
    streamsLoading: !loaded,
    error: groups.error ?? catalogue.error,
    retry: () => {
      void groups.refetch();
      void catalogue.refetch();
    },
    groups: groupList,
    rows,
    picked,
    plan,
    total,
    selected,
    search,
    setSearch,
    onlyPicked,
    onlyNew,
    show,
    setShow,
    streamsOf,
    groupTick: (group: SourceGroup): TickState =>
      loaded ? tickState(streamsOf(group), picked) : languageGroup(group) ? "on" : "off",
    groupPicked: (group: SourceGroup) =>
      streamsOf(group).filter((stream) => picked.has(stream.id)).length,
    toggleOpen: (group: SourceGroup) =>
      setOpen((before) => {
        const key = pickerGroupKey(group.name);
        const next = new Set(before);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    pickGroup: (group: SourceGroup, on: boolean) =>
      setChosen(setPicked(picked, streamsOf(group), on)),
    pickStream: (stream: SourceStreamEntry, on: boolean) =>
      setChosen(setPicked(picked, [stream], on)),
    pickShown: (on: boolean) => setChosen(setPicked(picked, shownStreams(rows), on)),
    pickedIds: () => pickedIds(streams, picked),
  };
};

/** The phone picker's state. */
export type PhonePickerState = ReturnType<typeof useStreamPicker>;
