import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  canCreateCollections,
  canSeeChannel,
  type ChannelId,
  draftFromRule,
  type DraftSeed,
  goesToOptions,
  isPlayable,
  newDraft,
  type Rule,
  type RuleId,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { problemOf } from "~/api/errors.ts";
import { useAvatarTones, useHouseholdTimeZone, useQueries, useRuleHistory } from "~/api/hooks.ts";
import { keys } from "~/api/queries.ts";
import { useRecordingDefaults, useViewer } from "~/api/viewer.ts";
import { Avatar } from "~/ui/avatar.tsx";
import { type Crumb, Crumbs } from "~/ui/crumbs.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "~/ui/states.tsx";
import { cn } from "~/ui/utils.ts";
import { SeriesEditor } from "./editor/index.tsx";

/*
 * The series recording editor's page (SPEC §8.6): what it loads, and its not found, error and
 * loading states. The form itself, section by section, is in ./editor.
 */

/** The page around the editor: crumbs, title, loading, not found. */
export function SeriesEditorPage({
  ruleId,
  seed,
}: {
  ruleId?: RuleId | undefined;
  seed?: DraftSeed | undefined;
}) {
  const queries = useQueries();
  const toneOf = useAvatarTones();
  const client = useQueryClient();
  const rule = useQuery({
    ...queries.rule(ruleId ?? ("" as RuleId)),
    enabled: ruleId !== undefined,
    // Opened from the list: the rule is already known, so the editor shows it at once.
    placeholderData: () =>
      client.getQueryData<readonly Rule[]>(keys.ruleList)?.find((item) => item.id === ruleId),
  });
  const channels = useQuery(queries.channels());
  const collections = useQuery(queries.collections());
  const me = useQuery(queries.me());
  const profiles = useQuery(queries.profiles());
  // The preview predicts what the server will match, so it counts days in the server's zone.
  const timeZone = useHouseholdTimeZone();
  const recordings = useQuery(queries.recordings());
  // Prefetched by the route, so "12 deleted episodes…" is there on the first frame.
  const history = useRuleHistory(ruleId);
  const { defaults, settled } = useRecordingDefaults();
  const viewer = useViewer();
  const { access } = viewer;
  const isNew = ruleId === undefined;
  // Loading until every read the form starts from has answered once, for this rule. Decided
  // once: a read asked again later (after a save) never turns the form back into a skeleton,
  // which would draw it afresh under a running save.
  const ready =
    (isNew || rule.data !== undefined) &&
    channels.data !== undefined &&
    me.data !== undefined &&
    timeZone !== undefined &&
    settled &&
    // A collection that follows a saved series recording changes Goes to and may add a notice.
    (isNew || (!collections.isPending && !history.isPending));
  const editorKey = ruleId ?? "new";
  const [readyFor, setReadyFor] = useState<string | undefined>(undefined);
  if (ready && readyFor !== editorKey) setReadyFor(editorKey);
  const loading = !ready && readyFor !== editorKey;

  const ruleError = rule.isError ? problemOf(rule.error) : undefined;
  if (ruleError?._tag === "NotFound") {
    return (
      <Wrap>
        <Crumbs crumbs={seriesCrumbs(m.series_title_edit())} />
        <EmptyState
          title={m.series_not_found()}
          action={
            <Button variant="primary" nativeButton={false} render={<Link to="/series" />}>
              {m.series_back()}
            </Button>
          }
        />
      </Wrap>
    );
  }
  if (ruleError !== undefined || channels.isError) {
    const offline = (ruleError ?? problemOf(channels.error))._tag === "Offline";
    return (
      <Wrap>
        <Crumbs crumbs={seriesCrumbs(isNew ? m.series_new() : m.series_title_edit())} />
        <ErrorState
          title={offline ? m.series_offline_title() : m.series_error_title()}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                void rule.refetch();
                void channels.refetch();
              }}
            >
              {m.action_try_again()}
            </Button>
          }
        />
      </Wrap>
    );
  }

  const ownerId = rule.data?.ownerId ?? me.data?.id;
  const ownerName =
    profiles.data?.find((profile) => profile.id === ownerId)?.displayName ??
    me.data?.displayName ??
    "";
  const recorded = (recordings.data ?? []).filter(
    (entry) => entry.ruleId === ruleId && isPlayable(entry),
  ).length;
  // While loading, a draft of a typical rule's shape stands in, so the form keeps its size.
  const placeholder = newDraft({ title: "Formel 1 live", channel: "placeholder" as ChannelId });
  // A collection-limited profile starts on its own collection (SPEC §7.8).
  const start = goesToOptions(
    access,
    (collections.data ?? []).map((collection) => collection.id),
    { mayCreateCollections: false },
  )?.initial;
  const fresh = {
    ...newDraft(seed),
    ...(start?._tag === "Collection" ? { collectionId: start.collectionId } : {}),
  };
  const initial = rule.data !== undefined ? draftFromRule(rule.data) : isNew ? fresh : placeholder;
  const visible = channels.data === undefined ? [] : channels.data.filter((c) => !c.hidden);
  const title = isNew ? m.series_new() : m.series_title_edit();

  return (
    <Wrap>
      <LoadingScope loading={loading}>
        {/*
          Short landscape drops the crumbs (Cancel in the save bar is the way back) and shows the
          title to assistive tech only, and the save bar is one 48 px row, so the summary and
          the first fields are on the first screen.
        */}
        <Crumbs
          crumbs={seriesCrumbs(isNew ? m.series_new() : (rule.data?.name ?? ""))}
          className="short:hidden"
        />
        <header
          className={cn(
            "flex flex-wrap items-end gap-x-4 gap-y-2 pt-3 pb-5 md:pb-6 short:pt-3 short:pb-2",
            // Nothing but the hidden title: no box at all, so no empty padding either.
            isNew && "short:contents",
          )}
        >
          <h1 className="mr-auto type-h1 short:sr-only">{title}</h1>
          {isNew ? null : (
            <span className="inline-flex items-center gap-2 text-[13px] text-fg-3">
              <Avatar name={ownerName || "?"} tone={toneOf(ownerId)} size={22} />
              <Sk chars={22}>
                {rule.data === undefined
                  ? ""
                  : m.series_owner_line({ owner: ownerName, count: recorded })}
              </Sk>
            </span>
          )}
        </header>
        <SeriesEditor
          key={loading ? "loading" : editorKey}
          initial={initial}
          data={{
            rule: rule.data,
            // The loading editor keeps its stand-ins until it is replaced as a whole: a channel
            // name or a collection arriving while other reads are still out would resize its
            // chips and move what follows them.
            channels: loading ? [] : visible.filter((channel) => canSeeChannel(access, channel.id)),
            collections: loading ? [] : (collections.data ?? []),
            viewer,
            ownerName,
            adminName: profiles.data?.find((profile) => profile.role === "admin")?.displayName,
            defaults,
            timeZone,
            mayEditCollections: me.data !== undefined && canCreateCollections(me.data),
            history: history.data?.count ?? 0,
          }}
        />
      </LoadingScope>
    </Wrap>
  );
}

/** "Series › New series recording": the way back, as a breadcrumb. */
const seriesCrumbs = (current: string): readonly Crumb[] => [
  { label: m.nav_series(), link: { to: "/series" } },
  { label: current, chars: 18 },
];
