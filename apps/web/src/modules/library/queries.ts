import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  canEditRule,
  type Channel,
  type Collection,
  type CollectionId,
  type Rule,
  type UserId,
} from "@slipstream/domain";
import { useHouseholdTimeZone, useQueries } from "~/api/hooks.ts";
import type { Entry } from "./library.ts";
import { shapes, useKept } from "~/api/shape-cache.ts";

// Stable empties, so lists derived from them keep their identity until an answer arrives.
const noRecordings: readonly Entry[] = [];
const noCollections: readonly Collection[] = [];
const noRules: readonly Rule[] = [];

/** What every Recordings screen reads besides its own data, and whether it is still loading. */
export interface LibraryData {
  readonly loading: boolean;
  /**
   * Whether the library's groups can be drawn: recordings, collections and series recordings
   * each have an answer, the server's or the one this browser kept. Groups drawn without one of
   * them would reflow once it arrives (a collection's recordings shown as shows first), so the
   * screens keep their cold placeholder until then (SPEC §6.2).
   */
  readonly collectionsKnown: boolean;
  readonly error: boolean;
  readonly recordings: readonly Entry[];
  readonly collections: readonly Collection[];
  /** The series recordings this profile sees (for names, offers and Series options). */
  readonly rules: readonly Rule[];
  readonly channel: (id: string) => Channel | undefined;
  readonly person: (id: UserId) => string | undefined;
  readonly ruleName: (id: string | undefined) => string | undefined;
  /** Whether this profile may change the rule (SPEC §7.8): admins any, everyone else their own. */
  readonly mayEditRule: (id: string | undefined) => boolean;
  readonly ruleCollection: (entry: Entry) => CollectionId | undefined;
  readonly isAdmin: boolean;
  readonly me: UserId | undefined;
  /** The household's zone (`system.timeZone`), undefined until the server answered. */
  readonly timeZone: string | undefined;
  readonly refetch: () => void;
}

/**
 * The shared reads of the Recordings screens: the one recordings list (SPEC §7.9), channels,
 * collections, rules and people for names. `loading` is this route's pending state, so the
 * skeleton belongs to the route that started it (SPEC §6.2).
 */
export function useLibraryData(): LibraryData {
  const queries = useQueries();
  const keptRecordings = useKept(shapes.recordings);
  const recordings = useQuery({
    ...queries.recordings(),
    placeholderData: (previous) => previous ?? keptRecordings,
  });
  const keptChannels = useKept(shapes.channels);
  const channels = useQuery({
    ...queries.channels(),
    placeholderData: (previous) => previous ?? keptChannels,
  });
  const keptCollections = useKept(shapes.collections);
  const collections = useQuery({
    ...queries.collections(),
    placeholderData: (previous) => previous ?? keptCollections,
  });
  const keptRules = useKept(shapes.rules);
  const rules = useQuery({
    ...queries.rules(),
    placeholderData: (previous) => previous ?? keptRules,
  });
  const keptProfiles = useKept(shapes.profiles);
  const profiles = useQuery({
    ...queries.profiles(),
    placeholderData: (previous) => previous ?? keptProfiles,
  });
  const keptMe = useKept(shapes.me);
  const me = useQuery({
    ...queries.me(),
    placeholderData: (previous) => previous ?? keptMe,
  });
  const timeZone = useHouseholdTimeZone();
  // Lookups by id, built once per answer: a long library asks for a channel per card.
  const lookups = useMemo(() => {
    const channelById = new Map<string, Channel>(
      (channels.data ?? []).map((channel) => [channel.id, channel]),
    );
    const nameById = new Map(
      (profiles.data ?? []).map((profile) => [profile.id, profile.displayName]),
    );
    const ruleById = new Map<string, Rule>((rules.data ?? []).map((rule) => [rule.id, rule]));
    const viewer = { id: me.data?.id, isAdmin: me.data?.role === "admin" };
    return {
      channel: (id: string) => channelById.get(id),
      person: (id: UserId) => nameById.get(id),
      ruleName: (id: string | undefined) => (id === undefined ? undefined : ruleById.get(id)?.name),
      mayEditRule: (id: string | undefined) => {
        const rule = id === undefined ? undefined : ruleById.get(id);
        return rule !== undefined && canEditRule(rule, viewer);
      },
      ruleCollection: (entry: Entry) =>
        entry.ruleId === undefined ? undefined : ruleById.get(entry.ruleId)?.collectionId,
    };
  }, [channels.data, profiles.data, rules.data, me.data]);
  return {
    // Days are named in the household's zone; until it is known the screens stay a skeleton.
    loading:
      timeZone === undefined ||
      [recordings, channels, collections, rules, me].some(
        (query) => query.isPending || query.isPlaceholderData,
      ),
    collectionsKnown: [recordings, collections, rules].every((query) => query.data !== undefined),
    error: recordings.isError,
    recordings: recordings.data ?? noRecordings,
    collections: collections.data ?? noCollections,
    rules: rules.data ?? noRules,
    ...lookups,
    isAdmin: me.data?.role === "admin",
    me: me.data?.id,
    timeZone,
    refetch: () => {
      void recordings.refetch();
    },
  };
}
