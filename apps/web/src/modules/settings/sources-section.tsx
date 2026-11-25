import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SourceCheck, SourceStreams } from "@slipstream/api";
import { hasStreamsToPick, type SourceView } from "@slipstream/domain";
import { DateTime } from "effect";
import { useRef, useState } from "react";
import { useApi, useQueries } from "~/api/hooks.ts";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { useRefreshSource, useUpdateSource } from "~/api/mutations.ts";
import { formatDuration } from "~/i18n/formats.ts";
import { m, sourceKindText } from "@slipstream/i18n";
import { Badge } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, RefreshIcon } from "~/ui/icons.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { rememberedList } from "~/ui/skeleton-state.ts";
import { EmptyState } from "~/ui/states.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { ResultNote } from "~/ui/result-note.tsx";
import { SettingsSection } from "./parts.tsx";
import { NeedsReview } from "./review/needs-review.tsx";
import { SectionProblem } from "./section-problem.tsx";
import { SourceForm } from "./source-form.tsx";
import { sourceFailureText } from "./source-text.ts";
import { groupsQuery, newCountQuery } from "./stream-picker/api.ts";
import { useOpenPicker } from "./stream-picker/open-picker.ts";
import { StreamPickerDialog } from "./stream-picker/picker-dialog.tsx";

const placeholderSource = (index: number): SourceView => ({
  id: `placeholder-${index}` as SourceView["id"],
  name: "Source name",
  config: {
    _tag: "M3u",
    playlistUrl: { url: "http://000.000.0.00:0000/playlist.m3u", hasCredentials: false },
  },
  refreshIntervalMinutes: 360,
  headers: {},
  guideCleanup: { removeDuplicates: true, rewrites: [] },
  enabled: true,
  health: "ok",
  secretHeaderNames: [],
});

/** A badge only when something is off: paused, unreachable, at its limit, not checked. */
function HealthBadge({ source }: { source: SourceView }) {
  if (!source.enabled) return <Badge tone="neutral">{m.series_paused()}</Badge>;
  switch (source.health) {
    case "ok":
      return null;
    case "unreachable":
      return <Badge tone="live">{m.source_health_unreachable()}</Badge>;
    case "limitReached":
      return <Badge tone="warn">{m.source_health_limit()}</Badge>;
    case "unknown":
      return <Badge tone="neutral">{m.source_health_unknown()}</Badge>;
  }
}

/**
 * One source (SPEC §8.7, §7.9): health, address, what it offers, the stream budget written from
 * the stream model ("1 of 2 streams in use · 2 kept for recordings"), the last check, and
 * Refresh now, Edit, Pause.
 */
function SourceCard({
  source,
  streams,
  now,
}: {
  source: SourceView;
  streams: SourceStreams | undefined;
  now: number;
}) {
  const queries = useQueries();
  const overlay = useOverlay();
  const placeholder = source.id.startsWith("placeholder-");
  const offered = useQuery({
    ...queries.sourceStreams(source.id),
    enabled: !placeholder,
  });
  const api = useApi();
  const fresh = useQuery({ ...newCountQuery(api, source.id), enabled: !placeholder });
  const openPicker = useOpenPicker();
  const refresh = useRefreshSource();
  const update = useUpdateSource();
  const [check, setCheck] = useState<SourceCheck | undefined>();
  const unreachable = source.enabled && source.health === "unreachable";
  const counts = streams?.counts;
  const lastRefresh =
    source.lastRefreshAt === undefined ? undefined : DateTime.toEpochMillis(source.lastRefreshAt);

  return (
    <article
      className={cn(
        "panel grid gap-3 px-4.5 py-3.5",
        unreachable && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--live)_40%,transparent)]",
      )}
      aria-labelledby={`source-${source.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 max-sm:basis-full">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]"
              id={`source-${source.id}`}
            >
              <Sk>{source.name}</Sk>
            </h3>
            <span className="sk-hide">
              <HealthBadge source={source} />
            </span>
          </div>
          <div className="text-meta text-fg-2">
            <Sk>
              {[
                sourceKindText(source.config._tag),
                offered.data === undefined
                  ? undefined
                  : m.source_streams_count({ count: offered.data.length }),
                counts?.maxStreams === undefined
                  ? undefined
                  : m.source_streams_of({
                      used: counts.recording + counts.watching,
                      max: counts.maxStreams,
                    }),
                lastRefresh === undefined
                  ? undefined
                  : m.source_updated_ago({
                      duration: formatDuration(Math.max(60_000, now - lastRefresh)),
                    }),
              ]
                .filter((part) => part !== undefined)
                .join(" · ")}
            </Sk>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 max-sm:-ml-2">
          <IconButton
            size="sm"
            label={unreachable ? m.source_test_again() : m.source_refresh()}
            disabled={refresh.isPending}
            onClick={() =>
              refresh.mutate(source.id, {
                onSuccess: (result) => setCheck(result),
                onError: () => setCheck(undefined),
              })
            }
          >
            <Icon icon={RefreshIcon} size={16} />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={() => openPicker(source.id)}>
            {source.reviewedAt !== undefined && (fresh.data ?? 0) > 0
              ? m.picker_new_streams({ count: fresh.data ?? 0 })
              : m.picker_title()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => overlay.open({ kind: "dlg", name: "source", arg: source.id })}
          >
            {m.source_edit()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            busy={update.isPending}
            onClick={() =>
              update.mutate(
                { id: source.id, update: { enabled: !source.enabled } },
                {
                  onSuccess: () =>
                    toast({
                      title: source.enabled
                        ? m.source_paused_named({ name: source.name })
                        : m.source_resumed_named({ name: source.name }),
                    }),
                },
              )
            }
          >
            {source.enabled ? m.action_pause() : m.action_resume()}
          </Button>
        </div>
      </div>
      {unreachable && check === undefined ? (
        <ResultNote tone="error">
          {m.source_unreachable_body(
            lastRefresh === undefined ? {} : { at: new Date(lastRefresh) },
          )}
        </ResultNote>
      ) : null}
      {check === undefined ? null : (
        <ResultNote tone="ok">
          {m.source_refresh_result({ streams: check.streams, programmes: check.programmes })}
        </ResultNote>
      )}
      {refresh.isError ? (
        <ResultNote tone="error">{sourceFailureText(refresh.error)}</ResultNote>
      ) : null}
    </article>
  );
}

/**
 * `?dlg=source` (add) and `?dlg=source:<id>` (edit). A new source is read at once: a small
 * playlist's streams are channels by then ("25 channels added"); a big one opens the picker.
 */
function SourceDialog({ sources }: { sources: readonly SourceView[] }) {
  const binding = useOverlayBinding("dlg", "source");
  const overlay = useOverlay();
  const api = useApi();
  const client = useQueryClient();
  const refresh = useRefreshSource();
  const openPicker = useOpenPicker();
  const afterCreate = (created: SourceView, name: string) =>
    refresh.mutate(created.id, {
      onSuccess: () =>
        void client.fetchQuery(groupsQuery(api, created.id)).then((groups) => {
          const added = groups.reduce((sum, group) => sum + group.added, 0);
          if (hasStreamsToPick(groups)) {
            openPicker(created.id);
            return;
          }
          toast({ title: m.picker_done({ created: added, joined: 0 }), type: "success" });
          void overlay.close();
        }),
      onError: () => {
        toast({ title: m.toast_saved_named({ name }) });
        void overlay.close();
      },
    });
  const firstField = useRef<HTMLInputElement | null>(null);
  const arg = binding.overlay?.arg;
  const source = sources.find((candidate) => candidate.id === arg);
  return (
    <Dialog
      open={binding.open}
      onOpenChange={binding.onOpenChange}
      label={source === undefined ? m.source_add() : m.action_edit_named({ name: source.name })}
      showTitle
      size="sm"
      keyboardFocus={firstField}
      footer={
        <>
          <Button variant="ghost" onClick={() => void overlay.close()}>
            {m.action_cancel()}
          </Button>
          <Button variant="primary" type="submit" form="source-form" busy={refresh.isPending}>
            {source === undefined ? m.source_add() : m.action_save()}
          </Button>
        </>
      }
    >
      <div className="p-5.5">
        <SourceForm
          key={arg ?? "new"}
          source={source}
          formId="source-form"
          firstField={firstField}
          onDone={({ name, created }) => {
            if (created !== undefined) {
              afterCreate(created, name);
              return;
            }
            toast({ title: m.toast_saved_named({ name }) });
            void overlay.close();
          }}
        />
      </div>
    </Dialog>
  );
}

/**
 * Settings › Sources & channels › Sources (SPEC §8.7): every source with its health and stream
 * budget, and Add source. The lineup is the Channels view (`lineup/channel-lineup.tsx`).
 */
export function SourcesSection() {
  const queries = useQueries();
  const overlay = useOverlay();
  const sources = useQuery(queries.sources());
  const streams = useQuery(queries.streams());
  const [now] = useState(() => Date.now());
  const keptSources = useKept(shapes.sources);

  if (sources.isError) return <SectionProblem error={sources.error} />;
  // While loading: the sources this browser saw last, so each card keeps its height; before any
  // load, a new household's shape (one source), so a first visit moves nothing either.
  const sourceList = rememberedList(
    "settings.sources",
    sources.data ?? keptSources,
    1,
    placeholderSource,
  );

  return (
    <>
      <NeedsReview />
      <LoadingScope loading={sources.isPending}>
        <SettingsSection
          title={m.sources_heading()}
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<Icon icon={AddIcon} />}
              onClick={() => overlay.open({ kind: "dlg", name: "source" })}
            >
              {m.source_add()}
            </Button>
          }
        >
          {sourceList.length === 0 ? (
            <EmptyState
              title={m.sources_empty()}
              action={
                <Button
                  variant="primary"
                  icon={<Icon icon={AddIcon} />}
                  onClick={() => overlay.open({ kind: "dlg", name: "source" })}
                >
                  {m.source_add()}
                </Button>
              }
            />
          ) : (
            sourceList.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                streams={streams.data?.find((item) => item.sourceId === source.id)}
                now={now}
              />
            ))
          )}
        </SettingsSection>
      </LoadingScope>
      <SourceDialog sources={sources.data ?? []} />
      <StreamPickerDialog sources={sources.data ?? []} />
    </>
  );
}
