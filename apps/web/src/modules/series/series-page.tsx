import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DateTime } from "effect";
import { useMemo, useState } from "react";
import type { RecordingEntry } from "@slipstream/api";
import {
  canEditRule,
  type Channel,
  type ChannelId,
  channelMark,
  isPlayable,
  type Rule,
  RuleId,
  UserId,
} from "@slipstream/domain";
import { problemOf } from "~/api/errors.ts";
import { useAvatarTones, useHouseholdTimeZone, useQueries } from "~/api/hooks.ts";
import { useSaveRule } from "~/api/mutations.ts";
import { useViewer, type Viewer } from "~/api/viewer.ts";
import { m, whenLabel } from "@slipstream/i18n";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import { Avatar } from "~/ui/avatar.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, GuideIcon, LockIcon } from "~/ui/icons.ts";
import { PageHeader, Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Switch } from "~/ui/primitives/switch.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/ui/primitives/tooltip.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { rememberedList } from "~/ui/skeleton-state.ts";
import { EmptyState, ErrorState } from "~/ui/states.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import { cn } from "~/ui/utils.ts";
import { cardSummary } from "./summary.ts";

/** A series recording's recordings: how many it made and the next one it will. */
interface RuleActivity {
  readonly recorded: number;
  readonly next: RecordingEntry | undefined;
}

const noActivity: RuleActivity = { recorded: 0, next: undefined };

/** Every series recording's activity in one pass over the recordings, not one pass per card. */
const activityByRule = (
  recordings: readonly RecordingEntry[],
  now: number,
): ReadonlyMap<string, RuleActivity> => {
  const byRule = new Map<string, { recorded: number; next: RecordingEntry | undefined }>();
  for (const entry of recordings) {
    if (entry.ruleId === undefined) continue;
    const activity = byRule.get(entry.ruleId) ?? { recorded: 0, next: undefined };
    byRule.set(entry.ruleId, activity);
    if (isPlayable(entry)) activity.recorded += 1;
    const start = DateTime.toEpochMillis(entry.start);
    const sooner =
      activity.next === undefined || start < DateTime.toEpochMillis(activity.next.start);
    if (entry.state === "scheduled" && start > now && sooner) activity.next = entry;
  }
  return byRule;
};

/** A series card (SPEC §8.6): art, name, owner, summary, next match, count, switch. */
function SeriesCard({
  rule,
  channels,
  activity,
  ownerName,
  showOwner,
  viewer,
  timeZone,
  now,
}: {
  rule: Rule;
  channels: readonly Channel[];
  activity: RuleActivity;
  ownerName: string;
  /** Only when more than one person records here: alone, whose it is goes without saying. */
  showOwner: boolean;
  viewer: Viewer;
  /** The household's zone "Today" and "Tomorrow" are counted in; undefined while it loads. */
  timeZone: string | undefined;
  now: number;
}) {
  const toneOf = useAvatarTones();
  const save = useSaveRule();
  const [optimistic, setOptimistic] = useState<boolean | undefined>(undefined);
  const enabled = optimistic ?? rule.enabled;
  const editable = canEditRule(rule, viewer);
  const channelName = (id: ChannelId) => channels.find((channel) => channel.id === id)?.name;
  const firstChannel = rule.matcher.channels[0];
  const firstName = firstChannel === undefined ? undefined : channelName(firstChannel);
  const toggle = (next: boolean) => {
    setOptimistic(next);
    save.mutate(
      { id: rule.id, update: { enabled: next } },
      {
        onSuccess: () =>
          toast({
            title: next ? m.series_turned_on() : m.series_turned_off(),
            description: rule.name,
          }),
        onError: () => toast({ title: m.series_problem_generic(), type: "error" }),
        onSettled: () => setOptimistic(undefined),
      },
    );
  };
  const link = { to: "/series/$id", params: { id: rule.id } } as const;
  return (
    <article
      className={cn(
        "grid min-w-0 grid-cols-[76px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg bg-surface p-3.5 shadow-card inset-ring-1 inset-ring-line transition-shadow duration-(--t-fast) hover:inset-ring-line-2 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:gap-4",
        !enabled && "opacity-60",
      )}
    >
      <Link
        {...link}
        aria-label={m.action_edit_named({ name: rule.name })}
        className="block rounded-[10px] coarse:grid coarse:min-h-11 coarse:content-center"
      >
        <Artwork
          subject={{
            title: rule.name,
            categories: rule.matcher.categories,
            ...(firstName === undefined ? {} : { channel: { mark: channelMark(firstName) } }),
          }}
          noMark
          title={{ kicker: "", main: rule.name.split(" · ")[0] ?? rule.name }}
          className="rounded-[10px]"
        />
      </Link>
      <Link {...link} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1" tabIndex={-1}>
        <span className="flex min-w-0 items-center gap-2">
          <b className="truncate type-h3">
            <Sk>{rule.name}</Sk>
          </b>
          {showOwner ? (
            <Avatar name={ownerName || "?"} tone={toneOf(rule.ownerId)} size={20} />
          ) : null}
        </span>
        <span className="line-clamp-2 min-h-[2lh] text-[13.5px] text-fg-2">
          <Sk chars={90}>{cardSummary(rule, channelName)}</Sk>
        </span>
        {/* One line each (two from 600 px on one row), so cards keep their height after load. */}
        {/* Drawn afresh once the zone is known: the count beside the line never slides along. */}
        <span
          key={timeZone === undefined ? "zone" : "next"}
          className="mt-1 grid gap-0.5 text-[12.5px] text-fg-3 sm:flex sm:items-center sm:gap-1.5"
        >
          {/* The next airing changes with the clock; it takes the free width, so the count after
              it stays put at the right edge instead of sliding along. */}
          <span className="min-w-0 truncate sm:flex-1">
            <Sk chars={30}>
              {/* Without the zone there is no "today" yet: the placeholder holds the line. */}
              {timeZone === undefined ? null : activity.next !== undefined ? (
                <>
                  {m.series_card_next()}{" "}
                  <b className="font-[650] text-brand-fg tabular-nums">
                    {whenLabel(DateTime.toEpochMillis(activity.next.start), now, timeZone)}
                  </b>
                  {` · ${activity.next.title}`}
                </>
              ) : enabled ? (
                m.series_card_nothing()
              ) : (
                m.series_paused()
              )}
            </Sk>
          </span>
          <span className="flex min-w-0 shrink-0 items-center gap-1 truncate">
            <Sk chars={12}>{m.series_card_recorded({ count: activity.recorded })}</Sk>
            {editable ? null : (
              <>
                <span aria-hidden="true">·</span>
                <Icon icon={LockIcon} size={14} className="shrink-0" />
                <span className="truncate">{m.series_read_only({ owner: ownerName })}</span>
              </>
            )}
          </span>
        </span>
      </Link>
      {editable ? (
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          aria-label={m.series_enabled_for({ name: rule.name })}
          className="mt-1"
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="mt-1 inline-flex">
                <Switch
                  checked={enabled}
                  disabled
                  aria-label={m.series_switch_read_only({ name: rule.name, owner: ownerName })}
                />
              </span>
            }
          />
          <TooltipContent side="left">{m.series_switch_tip({ owner: ownerName })}</TooltipContent>
        </Tooltip>
      )}
    </article>
  );
}

/** A series recording of the usual shape, drawn as a skeleton while the list loads. */
const placeholderRule = (index: number): Rule => ({
  id: RuleId.make(`placeholder-${index}`),
  name: "Formel 1 · live sessions",
  enabled: true,
  ownerId: UserId.make("placeholder"),
  matcher: { channels: [], title: [], categories: [], weekdays: [] },
  padding: { beforeMinutes: 5, afterMinutes: 60 },
  retention: { _tag: "KeepAll" },
  skipRepeats: true,
  offerDeclined: false,
  createdAt: DateTime.makeUnsafe(0),
});

/**
 * Series recordings (SPEC §8.6, recording model §1): the cards, filtered by the profile's access,
 * and the templates; the empty state points to the guide first.
 * Other people's series recordings are read-only for non-admins.
 */
export function SeriesPage() {
  const queries = useQueries();
  const rules = useQuery(queries.rules());
  const channels = useQuery(queries.channels());
  const recordings = useQuery(queries.recordings());
  const profiles = useQuery(queries.profiles());
  // "Today" and "Tomorrow" on the cards are household days: the cards wait for the zone.
  const timeZone = useHouseholdTimeZone();
  const now = useNow();
  const viewer = useViewer();
  const loading =
    rules.isPending || channels.isPending || !viewer.settled || timeZone === undefined;
  // The server lists only the rules this profile may see (SPEC §7.8); a profile switch drops
  // every cached answer, so the list is never another profile's.
  const list = rememberedList("rules", rules.data, 4, placeholderRule);
  const activity = useMemo(
    () => activityByRule(recordings.data ?? [], now),
    [recordings.data, now],
  );
  const ownerName = (rule: Rule) =>
    profiles.data?.find((profile) => profile.id === rule.ownerId)?.displayName ?? "";

  const newSeries = (variant: "primary" | "secondary" | "ghost") => (
    <Button
      variant={variant}
      icon={<Icon icon={AddIcon} />}
      nativeButton={false}
      render={<Link to="/series/new" />}
      disabled={!viewer.access.mayRecord}
    >
      {m.series_new()}
    </Button>
  );

  const problem = rules.isError ? problemOf(rules.error) : undefined;
  const offline = problem?._tag === "Offline";

  return (
    <Wrap>
      <PageHeader title={m.series_title()} actions={newSeries("ghost")} />
      {problem !== undefined ? (
        <ErrorState
          title={offline ? m.series_offline_title() : m.series_error_title()}
          actions={
            <Button variant="primary" onClick={() => void rules.refetch()}>
              {m.action_try_again()}
            </Button>
          }
        />
      ) : !loading && list.length === 0 ? (
        // A series recording usually starts from a programme, so the guide comes first.
        <EmptyState
          title={m.series_empty()}
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
              {newSeries("secondary")}
            </div>
          }
        />
      ) : (
        <LoadingScope loading={loading} className="grid gap-3 lg:grid-cols-2 lg:gap-4">
          {list.map((rule) => (
            <SeriesCard
              key={rule.id}
              rule={rule}
              channels={channels.data ?? []}
              activity={activity.get(rule.id) ?? noActivity}
              ownerName={ownerName(rule)}
              showOwner={(profiles.data?.length ?? 0) > 1}
              viewer={viewer}
              timeZone={timeZone}
              now={now}
            />
          ))}
        </LoadingScope>
      )}
    </Wrap>
  );
}
