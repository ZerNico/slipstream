import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import type { RecordingEntry, ScheduleConflict } from "@slipstream/api";
import {
  canEditRule,
  type Channel,
  type Collection,
  displayChannelName,
  epochMs,
  padRange,
  playTargetFor,
  type Programme,
  ProgrammeId,
  type RecordOptions,
  recordSheetState,
  type RepeatAiring,
  type Rule,
  type RuleId,
  scheduleConflictFor,
  seriesRule,
} from "@slipstream/domain";
import { m, pathLabels } from "@slipstream/i18n";
import { useHouseholdTimeZone, useQueries, useRuleOffer } from "~/api/hooks.ts";
import {
  useCreateRecording,
  useCreateSeriesCollection,
  useDeclineOffer,
  useDeleteRecording,
  useDeleteRule,
  useSaveRule,
  useStopRecording,
  useUndoSeriesCollection,
  useUpdateRecording,
} from "~/api/mutations.ts";
import type { OverlayComponentProps } from "~/shell/overlay-host.tsx";
import { announce } from "~/ui/announce-store.ts";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import { programmeSubject } from "~/ui/artwork/subjects.ts";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, PlayIcon, RecordIcon, RefreshIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Sheet } from "~/ui/sheet/sheet.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "~/ui/states.tsx";
import { Timeline } from "~/ui/timeline/timeline.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import { cn } from "~/ui/utils.ts";
import { dayPillLabel, daySentenceLabel } from "../labels.ts";
import { dayOf } from "../model.ts";
import {
  fetchWillRecord,
  useInvalidateRecordOptions,
  useProgramme,
  useRecordOptions,
} from "../queries.ts";
import { useViewer } from "~/api/viewer.ts";
import { extraTimeHint, offerPreview } from "../record-options.ts";
import { type RecordPlan, RecordSection } from "../record-section.tsx";
import { ConflictBox } from "./conflict-box.tsx";
import { SheetHeader } from "./header.tsx";
import { OfferStep, SeriesLine } from "./offer.tsx";
import { HadLine, HadStatus, type HadView } from "./record-rows.tsx";
import { inlineLink } from "./inline-link.ts";
import { RecordedStatus, StatusBox } from "./status-box.tsx";
import { type HadTarget, hadTarget, hadText, sheetContext, sheetFacts } from "./view-model.ts";

/**
 * How far around the programme the sheet reads the schedule's conflicts: wide enough to hold
 * any recording that overlaps it with its extra time (`paddingLimits.max`, 4 h) and then some.
 */
const conflictReachMs = 6 * 3_600_000;

/** Tells the reader an action didn't go through. */
const fail = () => {
  toast({ title: m.guide_action_failed(), type: "error" });
};

/**
 * Two footer buttons: each keeps its label on one line. They share a row while both fit, and
 * stack, each as wide as the footer, when they don't ("Nicht aufnehmen" beside "Serienaufnahme
 * ändern" at 390 px): the footer is a wrapping row whose items grow (`.sheet-footer`).
 */
const pair = (first: ReactNode, second: ReactNode) =>
  second === null || second === undefined || second === false ? (
    first
  ) : (
    <>
      {first}
      {second}
    </>
  );

/**
 * `?sheet=prog:<programmeId>` (SPEC §8.3): the programme sheet, opened from guide cells and from
 * cards anywhere. A bottom sheet on phones (artwork flush at the top, half snap sized to the
 * facts or the live timeline), a side drawer from 768 px. One primary in the pinned footer.
 */
export default function ProgrammeSheet({ open, overlay, onOpenChange }: OverlayComponentProps) {
  const id = ProgrammeId.make(overlay.arg ?? "");
  return <ProgrammeSheetFor key={id} id={id} open={open} onOpenChange={onOpenChange} />;
}

function ProgrammeSheetFor({
  id,
  open,
  onOpenChange,
}: {
  id: ProgrammeId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queries = useQueries();
  const now = useNow(30_000);
  const programme = useProgramme(id);
  const channels = useQuery(queries.channels());
  const recordings = useQuery(queries.recordings());
  const collections = useQuery(queries.collections());
  const rules = useQuery(queries.rules());
  const viewer = useViewer();
  const recordOptions = useRecordOptions(id);
  const timeZone = useHouseholdTimeZone();
  const start = programme.data ? epochMs(programme.data.start) : now;
  const end = programme.data ? epochMs(programme.data.end) : now;
  const conflicts = useQuery({
    ...queries.conflicts(start - conflictReachMs, end + conflictReachMs),
    enabled: programme.data !== undefined,
  });

  const channel = channels.data?.find((candidate) => candidate.id === programme.data?.channelId);
  const label = programme.data?.title ?? m.nav_guide();

  // Everything the first draw shows: the badge, a conflict and the series name wait with the
  // rest, so nothing pops in after the sheet is drawn.
  const loading =
    programme.data === undefined ||
    channels.isPending ||
    recordings.isPending ||
    collections.isPending ||
    rules.isPending ||
    conflicts.isPending ||
    !viewer.settled ||
    timeZone === undefined ||
    recordOptions.data === undefined;

  if (programme.isError) {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        label={m.guide_sheet_missing()}
        halfSnap={false}
      >
        <div className="p-5">
          <EmptyState
            title={m.guide_sheet_missing()}
            action={<Button onClick={() => onOpenChange(false)}>{m.action_close()}</Button>}
          />
        </div>
      </Sheet>
    );
  }

  return (
    <SheetBody
      open={open}
      onOpenChange={onOpenChange}
      label={label}
      loading={loading}
      programme={programme.data}
      channel={channel}
      timeZone={timeZone}
      channelNameOf={(channelId) => {
        const found = channels.data?.find((candidate) => candidate.id === channelId);
        return found === undefined ? undefined : displayChannelName(found.name);
      }}
      now={now}
      entries={recordings.data ?? []}
      conflicts={conflicts.data ?? []}
      collections={collections.data ?? []}
      ruleOf={(ruleId) => rules.data?.find((rule) => rule.id === ruleId)}
      ruleEditable={(ruleId) => {
        const rule = rules.data?.find((candidate) => candidate.id === ruleId);
        return rule !== undefined && canEditRule(rule, viewer);
      }}
      options={recordOptions.data}
      optionsError={recordOptions.isError}
      onRetryOptions={() => void recordOptions.refetch()}
    />
  );
}

function SheetBody({
  open,
  onOpenChange,
  label,
  loading,
  programme,
  channel,
  timeZone,
  channelNameOf,
  now,
  entries,
  conflicts,
  collections,
  ruleOf,
  ruleEditable,
  options,
  optionsError,
  onRetryOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  loading: boolean;
  programme: Programme | undefined;
  channel: Channel | undefined;
  /**
   * The household's zone. Day words are household days: until it is known the sheet stays a
   * skeleton and names no day at all, never one counted in another zone.
   */
  timeZone: string | undefined;
  /** A channel's name as rows show it ("ONE"), for "Already recorded … on ONE". */
  channelNameOf: (id: Channel["id"]) => string | undefined;
  now: number;
  entries: readonly RecordingEntry[];
  conflicts: readonly ScheduleConflict[];
  collections: readonly Collection[];
  ruleOf: (id: RuleId) => Rule | undefined;
  ruleEditable: (id: RuleId) => boolean;
  /** The server's record options; undefined while they load or when they failed. */
  options: RecordOptions | undefined;
  optionsError: boolean;
  onRetryOptions: () => void;
}) {
  const overlay = useOverlay();
  const queries = useQueries();
  const client = useQueryClient();
  const invalidate = useInvalidateRecordOptions();
  const createRecording = useCreateRecording();
  const saveRule = useSaveRule();
  const deleteRule = useDeleteRule();
  const deleteRecording = useDeleteRecording();
  const stopRecording = useStopRecording();
  const updateRecording = useUpdateRecording();
  const createSeriesCollection = useCreateSeriesCollection();
  const undoSeriesCollection = useUndoSeriesCollection();
  const declineOffer = useDeclineOffer();
  const [plan, setPlan] = useState<RecordPlan>({ mode: "once", chosen: undefined, goes: "auto" });
  const [offerOpen, setOfferOpen] = useState(false);
  const statusBox = useRef<HTMLDivElement | null>(null);

  // The series recording that records this airing, and the same when the viewer may change it:
  // its offer to group what it records (§3.3) takes the status box's second line.
  const ruleId = options?.status._tag === "Recorded" ? options.status.ruleId : undefined;
  const editRule = ruleId !== undefined && ruleEditable(ruleId) ? ruleId : undefined;
  const offer = useRuleOffer(editRule).data?.offer;

  const dayAt = (at: number) =>
    timeZone === undefined ? "" : daySentenceLabel(dayOf(at, now, timeZone));
  const start = programme === undefined ? now : epochMs(programme.start);
  const end = programme === undefined ? now : epochMs(programme.end);
  const day = timeZone === undefined ? undefined : dayOf(start, now, timeZone);
  // The header and the facts line say when from the same parts; until the zone is known there
  // is no day to name, and the header is the title alone.
  const when =
    day === undefined
      ? undefined
      : { channel: channel?.name ?? "", day: dayPillLabel(day), start, end };
  const context = programme !== undefined && when !== undefined ? sheetContext(when) : label;

  if (optionsError) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} label={label} context={context}>
        <div className="p-5">
          <ErrorState
            title={m.guide_options_failed()}
            actions={
              <Button icon={<Icon icon={RefreshIcon} />} onClick={onRetryOptions}>
                {m.action_try_again()}
              </Button>
            }
          />
        </div>
      </Sheet>
    );
  }

  // The server's answer is the only source of what a recording would be: until the programme
  // and its record options are both here, the sheet is its own layout as a skeleton.
  if (programme === undefined || options === undefined) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} label={label} context={context}>
        <LoadingScope loading>
          <div className="grid gap-4 px-5 pt-5 pb-6">
            <Sk className="block type-h2" chars={18}>
              {programme?.title}
            </Sk>
            <Sk className="block type-meta" data-half="" chars={40} />
            <hr className="border-line" />
            <Sk className="block type-meta" chars={32} />
            <Sk className="block type-meta" chars={24} />
          </div>
        </LoadingScope>
      </Sheet>
    );
  }

  const live = start <= now && end > now;
  const recordingId = options.status._tag === "Recorded" ? options.status.recordingId : undefined;
  const entry =
    recordingId === undefined
      ? undefined
      : entries.find((candidate) => candidate.id === recordingId);
  const conflict =
    recordingId === undefined ? undefined : scheduleConflictFor(recordingId, conflicts);
  const state = recordSheetState(options, { start, end }, now, conflict !== undefined);
  const hint = extraTimeHint(options.extraTime, plan.chosen);
  const initial = options.goesTo?.initial;
  const goes: RecordPlan["goes"] =
    plan.goes === "auto" && initial?._tag === "Collection" ? initial.collectionId : plan.goes;
  const effectivePlan: RecordPlan = { ...plan, goes };
  const { every } = options;

  const takeBack = (id: RuleId) =>
    deleteRule.mutate({ id, undo: true }, { onSuccess: () => void invalidate(), onError: fail });

  // Record stays busy while the save runs: it answers once the series recording is planned
  // and the record options and the library are refetched, so the sheet swaps once (§3.1).
  const recordSeries = async (collectionId: Exclude<RecordPlan["goes"], "auto"> | undefined) => {
    if (saveRule.isPending) return;
    let rule: Rule;
    try {
      rule = await saveRule.mutateAsync({
        rule: seriesRule(programme, hint.padding, collectionId),
      });
    } catch {
      toast({ title: m.guide_series_failed(), type: "error" });
      return;
    }
    // The count is the series preview's, as the sheet's line and the series editor say it.
    const count = await fetchWillRecord(client, queries, rule);
    const willRecord = count === undefined ? undefined : m.series_preview_count({ count });
    toast({
      title:
        willRecord === undefined
          ? m.series_created()
          : every.kind === "broadcasts"
            ? m.guide_series_added_every({ name: every.name, willRecord })
            : m.guide_series_added({ name: every.name, willRecord }),
      type: "recording",
      undo: () => takeBack(rule.id),
    });
  };

  const record = async () => {
    const collectionId = goes === "auto" ? undefined : goes;
    if (plan.mode === "every" && every.kind !== "none") {
      await recordSeries(collectionId);
      return;
    }
    try {
      await createRecording.mutateAsync({
        _tag: "Programme",
        programmeId: programme.id,
        ...(hint.overridesDefault ? { padding: hint.padding } : {}),
        ...(collectionId === undefined ? {} : { collectionId }),
      });
      toast({
        title: live
          ? m.guide_recording_started({ title: programme.title })
          : m.guide_recording_scheduled({ title: programme.title, start: new Date(start) }),
        type: "recording",
      });
      await invalidate();
    } catch {
      toast({ title: m.guide_record_failed(), type: "error" });
    }
  };

  // A one-off recording of an airing a series recording left out: owned by the viewer, no rule.
  const recordAnyway = async () => {
    try {
      await createRecording.mutateAsync({ _tag: "Programme", programmeId: programme.id });
      toast({ title: m.guide_recording_anyway({ title: programme.title }), type: "recording" });
      await invalidate();
    } catch {
      toast({ title: m.guide_record_failed(), type: "error" });
    }
  };

  const skip = async (id: RecordingEntry["id"], title: string) => {
    try {
      await deleteRecording.mutateAsync({ id });
      toast({ title: m.guide_skipped({ title }) });
      await invalidate();
    } catch {
      fail();
    }
  };

  // "Record the repeat instead": a one-off of the later airing the server picked, then this one
  // gives way. It is the same episode, so it goes by this programme's title.
  const recordRepeatInstead = async (self: RecordingEntry["id"], repeat: RepeatAiring) => {
    try {
      await createRecording.mutateAsync({ _tag: "Programme", programmeId: repeat.programmeId });
      await deleteRecording.mutateAsync({ id: self });
      toast({
        title: m.guide_recording_scheduled({
          title: programme.title,
          start: new Date(epochMs(repeat.start)),
        }),
        type: "recording",
      });
      await invalidate();
    } catch {
      fail();
    }
  };

  const closeOffer = () => {
    setOfferOpen(false);
    // The step goes away under the focus: it lands on the status box it opened from.
    statusBox.current?.focus();
  };
  const group = (id: RuleId, collectionName: string) => {
    if (offer === undefined) return;
    createSeriesCollection.mutate(
      { ruleId: id, request: { name: collectionName, layout: offer.layout } },
      {
        onSuccess: () => {
          closeOffer();
          const done = m.offer_done({ name: collectionName });
          announce(done);
          toast({
            title: done,
            alreadyAnnounced: true,
            undo: () => undoSeriesCollection.mutate(id, { onError: fail }),
          });
        },
        onError: () => toast({ title: m.guide_offer_failed(), type: "error" }),
      },
    );
  };
  const decline = (id: RuleId) => declineOffer.mutate(id, { onSuccess: closeOffer, onError: fail });

  // An ended programme nobody recorded may still be in pause & rewind (SPEC 7.6): the same pick
  // Home and the TV make. A recording of it plays as recorded; its range starts over.
  // The player says it itself when the buffer no longer holds it.
  const catchUp =
    state.kind === "ended"
      ? playTargetFor({ channelId: programme.channelId, programme, recordings: entries, now })
      : undefined;

  // ------------------------------------------------------------------------------------------
  // An episode the viewer already has (§3.1): what it is, and Play it / Show it.

  const openHad = (target: HadTarget) =>
    target.kind === "play"
      ? overlay.open({ kind: "choice", name: target.recordingId })
      : overlay.open({ kind: "sheet", name: "prog", arg: target.programmeId });
  const had: HadView | undefined =
    state.kind === "owned" || state.kind === "repeat"
      ? {
          text: hadText(state.of, {
            channelId: programme.channelId,
            dayAt,
            channelName: channelNameOf,
          }),
          target: hadTarget(state.of, entries),
          open: openHad,
        }
      : undefined;

  // ------------------------------------------------------------------------------------------
  // Footer

  const watchLive = () =>
    overlay.leaveTo({ to: "/watch/live/$channel", params: { channel: programme.channelId } });
  const seriesOptions = (id: string | undefined) =>
    id === undefined ? null : (
      <Button
        size="lg"
        variant="ghost"
        onClick={() => overlay.leaveTo({ to: "/series/$id", params: { id } })}
      >
        {m.guide_series_options()}
      </Button>
    );
  const canRecord = options.goesTo !== undefined;
  const watchButton = (id: RecordingEntry["id"] | undefined) => (
    <Button
      size="lg"
      variant="primary"
      icon={<Icon icon={PlayIcon} />}
      aria-haspopup="dialog"
      onClick={() => id && overlay.open({ kind: "choice", name: id })}
    >
      {m.player_watch()}
    </Button>
  );
  const recordButton = (primary: boolean) => (
    <Button
      size="lg"
      variant={primary ? "primary" : "secondary"}
      busy={createRecording.isPending || saveRule.isPending}
      icon={
        <span className={cn("inline-flex", !primary && "[&_svg]:text-live")}>
          <Icon icon={RecordIcon} />
        </span>
      }
      onClick={() => void record()}
    >
      {m.player_record()}
    </Button>
  );
  const recordAnywayButton = (
    <Button
      size="lg"
      variant="secondary"
      busy={createRecording.isPending}
      onClick={() => void recordAnyway()}
    >
      {m.guide_record_anyway()}
    </Button>
  );
  const watchLiveButton = (
    <Button
      size="lg"
      variant="primary"
      icon={<i className="size-2 rounded-full bg-live" aria-hidden="true" />}
      onClick={watchLive}
    >
      {m.player_watch_live()}
    </Button>
  );
  let footer: ReactNode;
  if (!loading) {
    switch (state.kind) {
      case "recording":
        footer = pair(watchButton(recordingId), seriesOptions(editRule));
        break;
      case "scheduled":
        footer = pair(
          <Button
            size="lg"
            variant="secondary"
            busy={deleteRecording.isPending}
            onClick={() => recordingId && void skip(recordingId, programme.title)}
          >
            {m.guide_skip_this()}
          </Button>,
          seriesOptions(editRule),
        );
        break;
      case "recorded":
        footer = watchButton(recordingId);
        break;
      case "household":
        footer = live ? watchLiveButton : undefined;
        break;
      case "ended":
        footer =
          catchUp?._tag === "Recording" ? (
            watchButton(catchUp.recordingId)
          ) : catchUp?._tag === "Range" ? (
            <Button
              size="lg"
              variant="primary"
              icon={<Icon icon={PlayIcon} />}
              onClick={() =>
                overlay.leaveTo({
                  to: "/watch/range/$channel",
                  params: { channel: catchUp.channelId },
                  search: {
                    start: epochMs(catchUp.range.start),
                    end: epochMs(catchUp.range.end),
                  },
                })
              }
            >
              {m.player_watch_from_start()}
            </Button>
          ) : undefined;
        break;
      // An episode the viewer merely has: the footer of a programme nobody records.
      case "owned":
      case "record":
        footer = state.live
          ? pair(watchLiveButton, canRecord ? recordButton(false) : null)
          : canRecord
            ? recordButton(true)
            : undefined;
        break;
      // Left out by a series recording: no primary unless it is on now (§3.6).
      case "repeat":
        footer = state.live
          ? pair(watchLiveButton, canRecord ? recordAnywayButton : null)
          : canRecord
            ? pair(
                recordAnywayButton,
                seriesOptions(ruleEditable(state.ruleId) ? state.ruleId : undefined),
              )
            : seriesOptions(ruleEditable(state.ruleId) ? state.ruleId : undefined);
        break;
    }
  }

  const recorded = state.kind === "recording" ? entry : undefined;
  const window = recorded ? padRange(recorded, recorded.padding) : undefined;
  const windowStart = window ? epochMs(window.start) : start;
  const windowEnd = window ? epochMs(window.end) : end;
  const facts = when === undefined ? (channel?.name ?? "") : sheetFacts(when, programme.categories);

  const seriesName = (id: RuleId) =>
    editRule === undefined ? (
      <b className="font-semibold text-fg">{ruleOf(id)?.name ?? ""}</b>
    ) : (
      <button
        type="button"
        className={inlineLink}
        onClick={() => overlay.leaveTo({ to: "/series/$id", params: { id: editRule } })}
      >
        {ruleOf(id)?.name ?? ""}
      </button>
    );

  const labels = pathLabels();
  const status = options.status;
  const ownedLine = state.kind === "owned" && had !== undefined ? <HadLine had={had} /> : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      label={label}
      context={context}
      art={
        <Artwork subject={programmeSubject(programme, channel, recorded ?? entry)} noTitle noMark />
      }
      {...(footer === undefined ? {} : { footer })}
    >
      <LoadingScope loading={loading}>
        <div className="grid gap-4 px-5 pt-5 pb-6 short:gap-2.5 short:pt-3">
          <SheetHeader
            programme={programme}
            channel={channel}
            state={loading ? undefined : state}
            live={live}
            facts={facts}
          />
          {live ? (
            <div>
              <Timeline
                variant="compact"
                data={{
                  start: windowStart,
                  end: windowEnd,
                  live: now,
                  ...(recorded
                    ? { captured: { start: windowStart, end: now }, marks: [start, end] }
                    : {}),
                  ...(recorded && recorded.positionMillis > 0
                    ? { playhead: windowStart + recorded.positionMillis }
                    : {}),
                }}
                caption={m.guide_started_ago({
                  agoMinutes: Math.max(0, Math.round((now - start) / 60_000)),
                  leftMinutes: Math.max(0, Math.round((end - now) / 60_000)),
                })}
              />
            </div>
          ) : null}
          {programme.description ? (
            <p className="text-[14.5px] text-fg-2 wrap-break-word" data-sheet-description="">
              {programme.description}
            </p>
          ) : null}
          <hr className="border-line" />

          {/* Nobody records it for the viewer yet: the record rows, with the Owned line above
              them (or alone when the viewer may not record); a left-out repeat's status box. */}
          {(state.kind === "record" || state.kind === "owned") && canRecord ? (
            <RecordSection
              options={options}
              plan={effectivePlan}
              onPlan={setPlan}
              hint={hint}
              collections={collections}
              status={ownedLine}
            />
          ) : (
            ownedLine
          )}
          {state.kind === "repeat" && had !== undefined ? <HadStatus had={had} /> : null}

          {state.kind === "ended" ? (
            <p className="type-meta">{m.guide_ended_not_recorded()}</p>
          ) : null}

          {state.kind === "household" ? (
            <StatusBox
              icon={<Icon icon={CheckIcon} />}
              tone="brand"
              title={m.guide_everyone_title()}
            />
          ) : null}

          {state.kind === "recorded" && recordingId ? (
            <StatusBox
              icon={<Icon icon={CheckIcon} />}
              tone="brand"
              title={m.guide_recorded()}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    overlay.leaveTo({ to: "/recordings/r/$id", params: { id: recordingId } })
                  }
                >
                  {m.guide_open_recording()}
                </Button>
              }
            />
          ) : null}

          {(state.kind === "recording" || state.kind === "scheduled") &&
          status._tag === "Recorded" ? (
            <>
              {conflict ? (
                <ConflictBox
                  conflict={conflict}
                  self={status.recordingId}
                  entries={entries}
                  repeat={state.kind === "scheduled" ? options.repeatAiring : undefined}
                  dayAt={dayAt}
                  repeatBusy={createRecording.isPending || deleteRecording.isPending}
                  onSkip={(id, title) => void skip(id, title)}
                  onRepeat={(repeat) => void recordRepeatInstead(status.recordingId, repeat)}
                  onAll={() => overlay.leaveTo({ to: "/recordings/scheduled" })}
                />
              ) : null}
              <RecordedStatus
                ref={statusBox}
                recording={state.kind === "recording"}
                title={
                  <>
                    {state.kind === "recording"
                      ? m.recordings_recording_now()
                      : state.conflict
                        ? m.guide_scheduled_conflict()
                        : ruleId === undefined
                          ? m.guide_will_be_recorded()
                          : m.status_scheduled()}
                    {ruleId === undefined ? null : (
                      <>
                        {" · "}
                        {m.guide_series_by()} {seriesName(ruleId)}
                      </>
                    )}
                  </>
                }
                sub={
                  ruleId === undefined ? (
                    <>
                      {m.recordings_by_hand()}
                      {" · "}
                      {m.guide_padding({
                        before: status.padding.beforeMinutes,
                        after: status.padding.afterMinutes,
                      })}
                    </>
                  ) : (
                    <SeriesLine
                      rule={ruleOf(ruleId)}
                      offer={offer}
                      offerOpen={offerOpen}
                      onOpenOffer={() => setOfferOpen(true)}
                    />
                  )
                }
                offer={
                  offerOpen && offer !== undefined && editRule !== undefined && timeZone ? (
                    <OfferStep
                      offer={offer}
                      preview={(collectionName) =>
                        offerPreview(collectionName, offer.layout, programme, labels, {
                          timeZone,
                          channelName: (id) =>
                            id === programme.channelId ? channel?.name : undefined,
                        })
                      }
                      busy={createSeriesCollection.isPending}
                      declining={declineOffer.isPending}
                      onGroup={(collectionName) => group(editRule, collectionName)}
                      onDecline={() => decline(editRule)}
                      onClose={closeOffer}
                    />
                  ) : null
                }
                padding={status.padding}
                end={end}
                onKeepAfter={(afterMinutes) =>
                  updateRecording.mutate(
                    {
                      id: status.recordingId,
                      update: { padding: { ...status.padding, afterMinutes } },
                    },
                    { onSuccess: () => void invalidate(), onError: fail },
                  )
                }
                stopping={stopRecording.isPending}
                onStop={() =>
                  stopRecording.mutate(status.recordingId, {
                    onSuccess: () => {
                      toast({ title: m.guide_stopped({ title: programme.title }) });
                      void invalidate();
                    },
                    onError: fail,
                  })
                }
              />
            </>
          ) : null}
        </div>
      </LoadingScope>
    </Sheet>
  );
}
