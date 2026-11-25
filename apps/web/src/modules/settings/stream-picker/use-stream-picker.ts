import { useQuery } from "@tanstack/react-query";
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
import { useDeferredValue, useMemo, useState } from "react";
import { useApi, useQueries } from "~/api/hooks.ts";
import { catalogueQuery, groupsQuery } from "./api.ts";

const noStreams: readonly SourceStreamEntry[] = [];
const noGroups: readonly SourceGroup[] = [];
const nothing: ReadonlySet<string> = new Set();

/** Streams a group still offers: not added yet. */
const pickableIn = (group: SourceGroup) => group.streams - group.added;

/**
 * The picker's state for one source: its groups (counts first, so the list has its shape at
 * once), every stream once loaded, what is ticked (the reader's language groups of a fresh
 * playlist), which groups are open, the search and "Selected", and what Add would make.
 */
export function useStreamPicker(sourceId: SourceId, options: { readonly onlyNew?: boolean } = {}) {
  const api = useApi();
  const groups = useQuery(groupsQuery(api, sourceId));
  const catalogue = useQuery(catalogueQuery(api, sourceId));
  const streams = catalogue.data ?? noStreams;
  const groupList = groups.data ?? noGroups;
  const loaded = catalogue.data !== undefined;
  const language = getLocale();
  // Fresh until someone has reviewed the source: streams that joined channels by guide id on
  // their own don't count as a choice.
  const sources = useQuery(useQueries().sources());
  const source = sources.data?.find((candidate) => candidate.id === sourceId);
  const fresh = source === undefined ? undefined : source.reviewedAt === undefined;

  const initial = useMemo(
    () => (loaded && fresh !== undefined ? defaultPicked(streams, language, fresh) : undefined),
    [loaded, streams, language, fresh],
  );
  const [chosen, setChosen] = useState<ReadonlySet<string> | undefined>(undefined);
  const picked: ReadonlySet<string> = chosen ?? initial ?? nothing;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [onlyNew, setOnlyNew] = useState(options.onlyNew === true);
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

  // Before the streams are in, the groups' counts say what the defaults will tick.
  const total = loaded
    ? streams.filter(isPickable).length
    : groupList.reduce((sum, group) => sum + pickableIn(group), 0);
  const selected = loaded
    ? picked.size
    : fresh
      ? groupList
          .filter((group) => group.name !== undefined && isLanguageGroup(group.name, language))
          .reduce((sum, group) => sum + pickableIn(group) - group.ignored, 0)
      : 0;

  /** A group's box: from its streams once loaded, else from the defaults. */
  const groupTick = (group: SourceGroup): TickState => {
    const key = pickerGroupKey(group.name);
    if (loaded) return tickState(byGroup.get(key) ?? [], picked);
    return fresh && group.name !== undefined && isLanguageGroup(group.name, language)
      ? "on"
      : "off";
  };
  /** How many of a group's streams are ticked. */
  const groupPicked = (group: SourceGroup): number =>
    (byGroup.get(pickerGroupKey(group.name)) ?? []).filter((stream) => picked.has(stream.id))
      .length;

  return {
    loading: groups.isPending,
    streamsLoading: !loaded,
    error: groups.error ?? catalogue.error,
    retry: () => {
      void groups.refetch();
      void catalogue.refetch();
    },
    groups: groupList,
    streams,
    rows,
    picked,
    plan,
    total,
    selected,
    search,
    setSearch,
    onlyPicked,
    setOnlyPicked,
    onlyNew,
    setOnlyNew,
    /** Whether the source has streams new since it was last reviewed. */
    hasNew: groupList.some((group) => group.new > 0),
    groupTick,
    groupPicked,
    /** Every stream of a group, shown or not. */
    groupStreams: (group: SourceGroup): readonly SourceStreamEntry[] =>
      byGroup.get(pickerGroupKey(group.name)) ?? noStreams,
    isOpen: (group: SourceGroup) => open.has(pickerGroupKey(group.name)),
    toggleOpen: (group: SourceGroup) =>
      setOpen((before) => {
        const key = pickerGroupKey(group.name);
        const next = new Set(before);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    /** Ticks or unticks a whole group (every stream of it, whatever is shown). */
    pickGroup: (group: SourceGroup, on: boolean) =>
      setChosen(setPicked(picked, byGroup.get(pickerGroupKey(group.name)) ?? [], on)),
    pickStream: (stream: SourceStreamEntry, on: boolean) =>
      setChosen(setPicked(picked, [stream], on)),
    /** Select all or none of what is shown. */
    pickShown: (on: boolean) => setChosen(setPicked(picked, shownStreams(rows), on)),
    /** The streams to send, in list order. */
    pickedIds: () => pickedIds(streams, picked),
  };
}

/** The picker's state, as the list and its summary read it. */
export type StreamPickerState = ReturnType<typeof useStreamPicker>;
