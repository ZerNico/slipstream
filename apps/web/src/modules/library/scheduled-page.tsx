import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { useDeleteRecording, useUpdateRecording } from "~/api/mutations.ts";
import { formatClock } from "~/i18n/formats.ts";
import { dayPill, m, resolveIntro } from "@slipstream/i18n";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import { Badge } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { GuideIcon, WarningIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { placeholderList } from "~/ui/skeleton-state.ts";
import { EmptyState, ErrorState } from "~/ui/states.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import { cn } from "~/ui/utils.ts";
import { channelLabel, entrySubject } from "./art.ts";
import { upcomingWindow } from "./conflicts.ts";
import { type Entry, programmeSpan } from "./library.ts";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { type LibraryData, useLibraryData } from "./queries.ts";
import { RecordingsHeader } from "./recordings-header.tsx";
import {
  epochMs,
  type ResolveOption,
  type Resolution,
  type ScheduledRow,
  scheduledDays,
  shortenedPadding,
} from "@slipstream/domain";

/** The resolution box: the overlap in words and one way out per item that can give way. */
function ResolveBox({ resolution }: { resolution: Resolution<Entry> }) {
  const remove = useDeleteRecording();
  const update = useUpdateRecording();
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const pick = (option: ResolveOption<Entry>) => {
    setBusy(option.entry.id);
    const done = () => setBusy(undefined);
    if (option.kind === "skip") {
      remove.mutate(
        { id: option.entry.id },
        {
          onSuccess: () => toast({ title: m.library_skipped_toast({ title: option.entry.title }) }),
          onError: () => toast({ title: m.library_action_failed(), type: "error" }),
          onSettled: done,
        },
      );
    } else {
      update.mutate(
        {
          id: option.entry.id,
          update: { padding: shortenedPadding(option) },
        },
        {
          onSuccess: () =>
            toast({
              title: m.library_shortened_toast({
                title: option.entry.title,
                at: new Date(option.endAt),
              }),
            }),
          onError: () => toast({ title: m.library_action_failed(), type: "error" }),
          onSettled: done,
        },
      );
    }
  };
  return (
    <div className="sk-hide col-span-full grid min-w-0 gap-2 pt-1.5 pb-1" data-resolve="">
      <p className="flex gap-2 text-[13.5px] text-fg">
        <Icon icon={WarningIcon} size={16} className="mt-0.5 shrink-0 text-warn-fg" />
        <span className="min-w-0">{resolveIntro(resolution)}</span>
      </p>
      {resolution.options.map((option, index) => {
        const span = programmeSpan(option.entry);
        return (
          <div
            key={`${option.kind}-${option.entry.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-surface px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <span className="min-w-0 flex-[1_1_240px] text-sm">
              <b className="font-semibold">
                {option.kind === "skip"
                  ? m.library_resolve_skip({ title: option.entry.title })
                  : m.conflict_end_other({ title: option.entry.title, at: new Date(option.endAt) })}
              </b>{" "}
              <span className="text-fg-3">
                {"· "}
                {option.kind === "skip"
                  ? m.library_resolve_skip_detail({
                      start: new Date(span.start),
                      end: new Date(span.end),
                    })
                  : m.library_resolve_end_detail({ keeps: option.keepsAfter, of: option.ofAfter })}
              </span>
            </span>
            <Button
              size="sm"
              variant={index === 0 ? "primary" : "secondary"}
              busy={busy === option.entry.id}
              disabled={busy !== undefined}
              onClick={() => pick(option)}
            >
              {option.kind === "skip" ? m.action_skip() : m.library_resolve_shorten()}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** One scheduled recording: time, artwork (opens the programme sheet), title, who, state. */
function ScheduledItem({ row, data }: { row: ScheduledRow<Entry>; data: LibraryData }) {
  const overlay = useOverlay();
  const { entry } = row;
  const channel = data.channel(entry.channelId);
  const rule = data.ruleName(entry.ruleId);
  const by = rule === undefined ? m.recordings_by_hand() : m.library_row_series({ name: rule });
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[68px_72px_minmax(0,1fr)] items-center gap-3.5 rounded-md p-2 transition-colors duration-(--t-fast) sm:grid-cols-[76px_88px_minmax(0,1fr)_auto] fine:hover:bg-hover",
        row.conflict &&
          "bg-warn-soft shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warn)_30%,transparent)] loading:bg-transparent loading:shadow-none",
      )}
    >
      <div className="min-w-0 text-[15px] font-bold whitespace-nowrap tabular-nums max-sm:text-sm">
        <Sk chars={5}>{formatClock(epochMs(entry.start))}</Sk>
      </div>
      <button
        type="button"
        className="relative block rounded-sm before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
        aria-label={m.library_row_details({ title: entry.title })}
        onClick={() =>
          entry.programmeId === undefined
            ? undefined
            : overlay.open({ kind: "sheet", name: "prog", arg: entry.programmeId })
        }
      >
        <Artwork className="rounded-sm" noTitle subject={entrySubject(entry, channel)} />
      </button>
      <div className="min-w-0">
        <div className="truncate font-semibold">
          <Sk placeholder={entry.title}>{entry.title}</Sk>
        </div>
        <div className="truncate text-[13px] text-fg-2">
          <Sk>{m.library_row_sub({ channel: channelLabel(channel), by })}</Sk>
        </div>
      </div>
      <div className="max-sm:hidden">
        {row.conflict ? (
          <Badge tone="warn" className="sk">
            {m.status_conflict()}
          </Badge>
        ) : (
          <Badge tone="sched" className="sk">
            {m.status_scheduled()}
          </Badge>
        )}
      </div>
      {row.resolution ? <ResolveBox resolution={row.resolution} /> : null}
    </div>
  );
}

/**
 * Recordings › Scheduled (SPEC §8.4): by day in the pills' notation, every item of an overlap
 * flagged, the resolution under the last item with one way out per item that can give way.
 */
export function ScheduledPage() {
  const data = useLibraryData();
  const queries = useQueries();
  const now = useNow(60_000);
  const window = upcomingWindow(now);
  const keptConflicts = useKept(shapes.conflicts);
  const keptSources = useKept(shapes.sources);
  const conflicts = useQuery({
    ...queries.conflicts(window.from, window.to),
    placeholderData: (previous) => previous ?? keptConflicts,
  });
  const sources = useQuery({
    ...queries.sources(),
    placeholderData: (previous) => previous ?? keptSources,
  });
  // Days are the household's, the ones the guide shows; none until the zone is known.
  const { recordings, timeZone } = data;
  const days = useMemo(
    () =>
      timeZone === undefined
        ? []
        : scheduledDays(recordings, conflicts.data ?? [], sources.data ?? [], timeZone),
    [recordings, conflicts.data, sources.data, timeZone],
  );
  const loading =
    data.loading ||
    conflicts.isPending ||
    conflicts.isPlaceholderData ||
    sources.isPending ||
    sources.isPlaceholderData;
  // While loading, the days are drawn from the answers this browser kept (SPEC §6.2), so the
  // loaded days land in the same boxes. Missing one (conflicts and sources add flags and
  // resolution boxes), the list stays the day skeleton: nothing arrives under a drawn row.
  const drawable =
    !loading ||
    (data.collectionsKnown &&
      timeZone !== undefined &&
      conflicts.data !== undefined &&
      sources.data !== undefined);
  return (
    <Wrap>
      <RecordingsHeader data={data} />
      <LoadingScope loading={loading}>
        {data.error ? (
          <ErrorState
            title={m.library_error_title()}
            actions={<Button onClick={data.refetch}>{m.action_try_again()}</Button>}
          />
        ) : drawable && days.length === 0 ? (
          <EmptyState
            title={m.recordings_upcoming_empty()}
            action={
              <Button
                variant="primary"
                icon={<Icon icon={GuideIcon} />}
                nativeButton={false}
                render={<Link to="/guide" />}
              >
                {m.action_open_guide()}
              </Button>
            }
          />
        ) : (
          <>
            {!drawable ? (
              <section className="mb-7" data-scheduled-skeleton="">
                <h3 className="mb-2 py-2 text-sm font-semibold text-fg-2">
                  <Sk chars={8} />
                </h3>
                <div className="grid gap-0.5">
                  {placeholderList(undefined, 5, (index) => index).map((index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[68px_72px_minmax(0,1fr)] items-center gap-3.5 p-2 sm:grid-cols-[76px_88px_minmax(0,1fr)_auto]"
                    >
                      <Sk chars={5} />
                      <span className="sk-art aspect-video rounded-sm" />
                      <span className="grid gap-1">
                        <Sk chars={20} />
                        <Sk chars={20} />
                      </span>
                      <span className="max-sm:hidden">
                        <Sk chars={9} />
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              days.map((day) => (
                <section
                  key={day.day}
                  className="mb-7"
                  aria-label={dayPill(day.day, now, data.timeZone)}
                >
                  <h3 className="sticky top-[calc(var(--nav-h)+var(--safe-t))] z-2 mb-2 bg-bg py-2 text-sm font-semibold text-fg-2">
                    <Sk>{dayPill(day.day, now, data.timeZone)}</Sk>
                  </h3>
                  <div className="grid gap-0.5">
                    {day.rows.map((row) => (
                      <ScheduledItem key={row.entry.id} row={row} data={data} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </LoadingScope>
    </Wrap>
  );
}
