import type { RecordingEntry } from "@slipstream/api";
import { canEditRule, epochMs, type Rule, UserId } from "@slipstream/domain";
import { m, whenLabel } from "@slipstream/i18n";
import { householdZone } from "../data/zone.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { queryKeys } from "../api/keys.ts";
import { apiActions } from "../api/queries.ts";
import { useApiQueries } from "../data/hooks.ts";
import { channelNames } from "../data/home.ts";
import { useSession } from "../session/session-context.ts";
import { useToast } from "../ui/toast.ts";

/** A series recording with what it has recorded and what comes next. */
export interface SeriesItem {
  readonly rule: Rule;
  /** Its recordings in the library and failed ones, newest first. */
  readonly recorded: readonly RecordingEntry[];
  /** What it has scheduled, soonest first. */
  readonly upcoming: readonly RecordingEntry[];
  /** Whether this profile may switch it on and off or delete it (its owner, or an admin). */
  readonly mine: boolean;
}

/**
 * The series recordings this profile sees, by name, each with its recordings and what it has
 * scheduled, and the writes a phone makes to one: switch it on or off, delete it.
 */
export const useSeries = () => {
  const queries = useApiQueries();
  const queryClient = useQueryClient();
  const { account, runAction } = useSession();
  const toast = useToast();
  const rules = useQuery(queries.rules());
  const recordings = useQuery(queries.recordings());
  const channels = useQuery(queries.channels());
  const all = recordings.data ?? [];
  const viewer = {
    id: account === undefined ? undefined : UserId.make(account.userId),
    isAdmin: account?.role === "admin",
  };
  const items: readonly SeriesItem[] = (rules.data ?? [])
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((rule) => {
      const own = all.filter((entry) => entry.ruleId === rule.id);
      return {
        rule,
        recorded: own
          .filter((entry) => entry.state !== "scheduled" && entry.state !== "cancelled")
          .toSorted((a, b) => epochMs(b.start) - epochMs(a.start)),
        upcoming: own
          .filter((entry) => entry.state === "scheduled")
          .toSorted((a, b) => epochMs(a.start) - epochMs(b.start)),
        mine: canEditRule(rule, viewer),
      };
    });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
    ]);
  return {
    items,
    names: channelNames(channels.data ?? []),
    loading: rules.isPending || recordings.isPending,
    error: rules.error ?? recordings.error,
    retry: () => {
      void rules.refetch();
      void recordings.refetch();
    },
    setEnabled: (rule: Rule, enabled: boolean) => {
      void Haptics.selectionAsync();
      runAction(apiActions.updateRule(rule.id, { enabled }))
        .then(refresh)
        .then(() => toast({ text: enabled ? m.series_turned_on() : m.series_turned_off() }))
        .catch(() => toast({ text: m.library_action_failed() }));
    },
    remove: (rule: Rule) =>
      runAction(apiActions.deleteRule(rule.id))
        .then(refresh)
        .then(() => toast({ text: m.series_deleted() }))
        .catch(() => toast({ text: m.library_action_failed() })),
  };
};

/** The next airing a series recording has scheduled, as "Next: Tue 24 20:15", or nothing. */
export const nextLine = (item: SeriesItem, now: number): string => {
  const next = item.upcoming[0];
  if (next === undefined) return m.series_card_nothing();
  const start = epochMs(next.start);
  return m.series_card_next_at({ when: whenLabel(start, now, householdZone()) });
};
