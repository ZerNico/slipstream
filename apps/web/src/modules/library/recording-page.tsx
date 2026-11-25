import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import {
  channelMark,
  cleanTitle,
  epochMs,
  findRepeatAiring,
  isProblemRecording,
  needsRepeat,
  type RecordingId,
  recordSheetState,
  renderPath,
  scheduleConflictFor,
} from "@slipstream/domain";
import { useQueries } from "~/api/hooks.ts";
import { problemOf } from "~/api/errors.ts";
import { useCreateRecording, useKeepOriginal } from "~/api/mutations.ts";
import { dayPill, m, pathLabels, recordingFacts, rerunText, sentenceDay } from "@slipstream/i18n";
import { useSuppressMiniPlayer } from "~/shell/mini-player-store.ts";
import { Artwork, ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Badge } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { PlayIcon, RecordIcon, RefreshIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { EmptyState } from "~/ui/states.tsx";
import { Timeline } from "~/ui/timeline/timeline.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import { entrySubject } from "./art.ts";
import { CollectionMenu } from "./collection-menu.tsx";
import { Crumbs, type Crumb } from "~/ui/crumbs.tsx";
import { upcomingWindow } from "./conflicts.ts";
import {
  deleteChoice,
  opensChoice,
  type PrimaryAction,
  primaryAction,
  primaryLabel,
} from "./detail.ts";
import { groupKeyOf } from "./groups.ts";
import { programmeSpan, recordingTimeline } from "./library.ts";
import { entryProblem } from "./problem-text.ts";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { useLibraryData } from "./queries.ts";
import { DeleteConfirm, RecordingActions } from "./recording-actions.tsx";
import { RecordingFacts } from "./recording-facts.tsx";
import { RecordingProblem } from "./recording-problem.tsx";

/**
 * The recording detail (SPEC §8.4 and the open issue on running recordings): artwork with its
 * source, the gap timeline when incomplete, the problem box with its fix, the primary action
 * (the watch choice for anything that started), Protect, the ⋯ menu with an inline Delete, where
 * it sits, and the facts. A running recording shows REC, its length "so far" and where it will
 * be exported when it ends.
 */
export function RecordingPage({ id }: { id: RecordingId }) {
  const data = useLibraryData();
  const queries = useQueries();
  const overlay = useOverlay();
  const now = useNow(15_000);
  const keptEntry = useKept(shapes.recordings)?.find((entry) => entry.id === id);
  const query = useQuery({
    ...queries.recording(id),
    placeholderData: () => keptEntry,
  });
  const keepOriginal = useKeepOriginal();
  const recordRepeat = useCreateRecording();
  // A damaged recording made by hand has no automatic search for its repeat: the guide is asked
  // for the same episode (`findRepeatAiring`), and "Record the repeat" records it.
  const manualDamaged =
    query.data !== undefined && query.data.ruleId === undefined && needsRepeat(query.data);
  const showTitle = query.data === undefined ? "" : cleanTitle(query.data.title);
  const repeatSearch = useQuery({
    ...queries.guideSearch(showTitle),
    enabled: manualDamaged && showTitle !== "",
  });
  // The conflicts the Scheduled tab reads, so a scheduled item says Conflict where it says so.
  const upcoming = upcomingWindow(now);
  const keptConflicts = useKept(shapes.conflicts);
  const conflicts = useQuery({
    ...queries.conflicts(upcoming.from, upcoming.to),
    placeholderData: (previous) => previous ?? keptConflicts,
    enabled: query.data?.state === "scheduled",
  });
  const [confirming, setConfirming] = useState(false);
  const moreRef = useRef<HTMLSpanElement | null>(null);
  useSuppressMiniPlayer([id]);

  const missing = query.isError && problemOf(query.error)._tag === "NotFound";
  if (missing) {
    return (
      <Wrap>
        <Crumbs
          crumbs={[
            { label: m.nav_recordings(), link: { to: "/recordings" } },
            { label: m.library_title_recording() },
          ]}
        />
        <div className="pt-6">
          <EmptyState
            title={m.library_missing_title()}
            action={
              <Button nativeButton={false} render={<Link to="/recordings" />}>
                {m.library_back_to_recordings()}
              </Button>
            }
          />
        </div>
      </Wrap>
    );
  }

  const entry = query.data;
  const loading =
    query.isPending ||
    query.isPlaceholderData ||
    data.loading ||
    (manualDamaged && showTitle !== "" && repeatSearch.isPending);
  const labels = pathLabels();
  const path = entry ? renderPath(entry.group, labels) : [];
  const folders = path.slice(0, -1);
  const key = entry ? groupKeyOf(entry, labels) : "";
  const crumbs: Crumb[] = [
    { label: m.nav_recordings(), link: { to: "/recordings" } },
    ...folders.map((folder, index): Crumb =>
      index === 0
        ? { label: folder, link: { to: "/recordings/c/$group/{-$season}", params: { group: key } } }
        : index === 1 && folders.length >= 3
          ? {
              label: folder,
              link: {
                to: "/recordings/c/$group/{-$season}",
                params: { group: key, season: folder },
              },
            }
          : { label: folder },
    ),
    { label: path.at(-1) ?? entry?.title ?? m.library_title_recording() },
  ];
  const channel = entry ? data.channel(entry.channelId) : undefined;
  const subject = entry ? entrySubject(entry, channel) : { title: m.library_title_recording() };
  const problem = entry && isProblemRecording(entry) ? entryProblem(entry) : undefined;
  // Gaps over the whole window read as failed, whatever state the server reported.
  const failed = problem?.failed ?? false;
  const action: PrimaryAction =
    entry === undefined || failed ? { kind: "none" } : primaryAction(entry);
  const choice = opensChoice(action);
  const running = entry?.state === "recording";
  const span = entry ? programmeSpan(entry) : undefined;
  // The programme sheet's states (SPEC §8.3), so a scheduled item offers the same actions here.
  const sheet =
    entry === undefined || span === undefined
      ? undefined
      : recordSheetState(
          {
            status: {
              _tag: "Recorded",
              recordingId: entry.id,
              state: entry.state,
              padding: entry.padding,
            },
          },
          span,
          now,
          scheduleConflictFor(entry.id, conflicts.data ?? []) !== undefined,
        );
  const scheduled = sheet?.kind === "scheduled" ? sheet : undefined;
  const editRule = entry && data.mayEditRule(entry.ruleId) ? entry.ruleId : undefined;
  const rule = data.rules.find((candidate) => candidate.id === entry?.ruleId);
  const rerun = entry ? rerunText(entry, now, data.timeZone, data.recordings) : undefined;
  // A repeat that replaced its original may bring it back while the server allows it: it names
  // the deadline (`keepUntil`) only then, never for an anchor or past the hidden retention.
  const keepUntil = entry?.replaces?.keepUntil;
  const keepable = keepUntil !== undefined && epochMs(keepUntil) > now;
  const repeatAiring =
    manualDamaged && entry !== undefined && data.timeZone !== undefined
      ? findRepeatAiring(entry, repeatSearch.data ?? [], {
          timeZone: data.timeZone,
          channelName: (channelId) => data.channel(channelId)?.name,
        })
      : undefined;
  const repeatPlanned =
    repeatAiring !== undefined &&
    data.recordings.some(
      (candidate) => candidate.programmeId === repeatAiring.id && candidate.state !== "cancelled",
    );
  // "Record the repeat": quiet beside the incomplete line, the first fix in the failed box.
  const recordRepeatButton = (variant: "primary" | "secondary") =>
    entry === undefined || repeatAiring === undefined || repeatPlanned ? null : (
      <Button
        size="sm"
        variant={variant}
        icon={<Icon icon={RecordIcon} size={16} />}
        busy={recordRepeat.isPending}
        onClick={() =>
          recordRepeat.mutate(
            { _tag: "Programme", programmeId: repeatAiring.id },
            {
              onSuccess: () =>
                toast({
                  title: m.library_recording_repeat({ title: entry.title }),
                  type: "recording",
                }),
              onError: () => toast({ title: m.library_action_failed(), type: "error" }),
            },
          )
        }
      >
        {m.library_record_repeat({
          day: dayPill(epochMs(repeatAiring.start), now, data.timeZone),
          start: new Date(epochMs(repeatAiring.start)),
        })}
      </Button>
    );
  const openChoice = () => entry && overlay.open({ kind: "choice", name: entry.id });

  // One decision for the artwork's play overlay and the primary button: both exist only when
  // there is something to play (never for a scheduled or failed recording).
  const play = (className: string, children: ReactNode, label: string) =>
    !entry || action.kind === "none" ? null : choice ? (
      <button type="button" className={className} aria-label={label} onClick={openChoice}>
        {children}
      </button>
    ) : (
      <Link
        to="/watch/rec/$id"
        params={{ id: entry.id }}
        search={{ at: "start" }}
        className={className}
        aria-label={label}
      >
        {children}
      </Link>
    );

  return (
    <Wrap>
      <Crumbs crumbs={crumbs} />
      <LoadingScope loading={loading}>
        <div className="grid gap-7 pt-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
          <div className="grid min-w-0 gap-4">
            <div className="relative">
              {/* The title is the heading beside it; the art carries none, so the disc is clear. */}
              <Artwork subject={subject} className="rounded-lg" noTitle />
              {/* The whole picture plays; the disc sits bottom-right, clear of the art's title. */}
              {play(
                "absolute inset-0 z-2 grid place-items-end rounded-lg p-3 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus",
                <span className="card-play-disc size-14" aria-hidden="true">
                  <Icon icon={PlayIcon} size={24} />
                </span>,
                entry ? primaryLabel(entry) : m.player_play(),
              )}
            </div>
            {entry && entry.state === "incomplete" ? (
              <Timeline
                data={recordingTimeline(entry, now)}
                variant="compact"
                relative
                label={m.library_problem_incomplete()}
              />
            ) : null}
            {entry?.description ? (
              <p className="text-fg-2">
                <Sk>{entry.description}</Sk>
              </p>
            ) : null}
          </div>
          {/*
            Cold, with no kept answer, the title's length, the description above (on phones)
            and the actions are unknown. The column is drawn afresh once the recording is known,
            so it lands in new boxes instead of sliding under a title that took two lines.
          */}
          <div key={entry === undefined ? "cold" : "known"} className="grid min-w-0 gap-5">
            <div className="grid gap-2">
              {/* The badge row is always there, so REC arriving never moves the title. */}
              <div className="flex h-[22px] min-w-0 items-center gap-2.5">
                <span className="min-w-0 truncate text-meta text-fg-3">
                  <Sk chars={14}>{folders.join(" › ")}</Sk>
                </span>
                {running ? <Badge tone="live">{m.status_rec()}</Badge> : null}
                {scheduled === undefined ? null : scheduled.conflict ? (
                  <Badge tone="warn">{m.status_conflict()}</Badge>
                ) : (
                  <Badge tone="sched">{m.status_scheduled()}</Badge>
                )}
              </div>
              <h1 className="font-display text-[clamp(28px,3.2vw,40px)] leading-[1.05] font-[720] tracking-[-0.035em] break-words">
                <Sk chars={15}>{entry?.title}</Sk>
              </h1>
              {/* One quiet line, as Infuse writes it: channel · when · length · size. */}
              <p
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-fg-2 tabular-nums"
                data-meta=""
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ChannelLogo
                    size="sm"
                    mark={channelMark(channel?.name ?? "")}
                    {...(channel?.logoUrl ? { logoUrl: channel.logoUrl } : {})}
                  />
                  <Sk chars={12} className="min-w-0 truncate">
                    {channel?.name}
                  </Sk>
                </span>
                <span aria-hidden="true">·</span>
                <Sk chars={34}>{entry ? recordingFacts(entry, now, data.timeZone) : undefined}</Sk>
              </p>
            </div>
            {problem === undefined ? null : (
              <RecordingProblem problem={problem} rerun={rerun} recordRepeat={recordRepeatButton} />
            )}
            <RecordingActions
              id={id}
              entry={entry}
              action={action}
              choice={choice}
              failed={failed}
              scheduled={scheduled !== undefined}
              editRule={editRule}
              now={now}
              timeZone={data.timeZone}
              moreRef={moreRef}
              onOpenChoice={openChoice}
              onAskDelete={() => setConfirming(true)}
            />
            {confirming && entry ? (
              <DeleteConfirm
                entry={entry}
                choice={deleteChoice(entry, rule)}
                onKeep={() => {
                  setConfirming(false);
                  moreRef.current?.querySelector("button")?.focus();
                }}
              />
            ) : null}
            {entry?.replaces === undefined ? null : (
              <div
                data-replaces=""
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md bg-hover px-3.5 py-3 text-[13.5px] text-fg-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <Icon icon={RefreshIcon} />
                <span className="min-w-0">
                  {m.library_replaces({
                    day: sentenceDay(epochMs(entry.replaces.start), now, data.timeZone),
                  })}
                </span>
                {keepable ? (
                  <span className="col-span-2 justify-self-start sm:col-span-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      busy={keepOriginal.isPending}
                      onClick={() =>
                        // The endpoint takes the repeat, the recording open here.
                        keepOriginal.mutate(entry.id, {
                          onSuccess: () => toast({ title: m.library_kept_original() }),
                          onError: () => toast({ title: m.library_action_failed(), type: "error" }),
                        })
                      }
                    >
                      {m.library_keep_original()}
                    </Button>
                  </span>
                ) : null}
              </div>
            )}
            {/* Where it sits, as the way to move it; a failed recording sits nowhere. */}
            {failed ? null : (
              <div>
                {entry === undefined ? (
                  <Button size="sm" variant="secondary" disabled>
                    <Sk chars={10} />
                  </Button>
                ) : (
                  <CollectionMenu entry={entry} data={data} />
                )}
              </div>
            )}
            <RecordingFacts entry={entry} data={data} scheduled={scheduled !== undefined} />
          </div>
        </div>
      </LoadingScope>
    </Wrap>
  );
}
