import type { RecordingEntry, ScheduleConflict } from "@slipstream/api";
import {
  type ChoiceOption,
  type GuideEntry,
  type Padding,
  paddingEquals,
  type Recording,
  type RecordingChoice,
  seriesRule,
} from "@slipstream/domain";
import { conflictText, formatters, m } from "@slipstream/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Effect } from "effect";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, useTVEventHandler, View, type TVRemoteEvent } from "react-native";
import type { Api } from "../api/client.ts";
import { queryKeys } from "../api/keys.ts";
import { apiActions } from "../api/queries.ts";
import { useApiQueries } from "../data/hooks.ts";
import { conflictWords } from "../data/recording-text.ts";
import { playerParams, type PlayTarget } from "../player/playback.ts";
import { choiceTarget, pickTarget } from "../player/watch-choice.ts";
import { useRemind } from "../session/remind-context.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { TOAST_ACTION_MILLIS, useToast } from "../ui/toast.ts";
import { useNow } from "../ui/use-now.ts";
import { readPress } from "../tv/guide/remote.ts";
import { OptionRow } from "../ui/OptionRow.tsx";
import { WatchChoiceSheet } from "../player/WatchChoiceSheet.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { Bone, Skeleton } from "../ui/Skeleton.tsx";
import { type OfferStep, offerAfterCreate, offerStepActions, seriesUndo } from "./offer-step.ts";
import {
  recordOnceRequest,
  type RepeatStatus,
  repeatStatus,
  sheetPlan,
  sheetProgramme,
  stepPadding,
  type PaddingSide,
  type SheetPlan,
  type SheetProgramme,
} from "./record-options.ts";
import { useCloseTimer } from "./use-close-timer.ts";

/** One arrow of a stepper; on phone a touch target of its own, on TV only a glyph. */
const StepArrow = ({
  icon,
  label,
  color,
  onPress,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly color: string;
  readonly onPress: (() => void) | undefined;
}) => {
  const { em } = useTheme();
  if (onPress === undefined) return <Icon name={icon} size={em} color={color} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={0.6 * em}
      onPress={onPress}
      style={{ padding: 0.3 * em }}
    >
      <Icon name={icon} size={1.2 * em} color={color} />
    </Pressable>
  );
};

/**
 * A padding stepper value: "◀ 2 min ▶". On TV left and right move it and the arrows light up
 * while its row has focus; on phone the arrows are buttons.
 */
const Stepper = ({
  minutes,
  active,
  onStep,
}: {
  readonly minutes: number;
  readonly active: boolean;
  /** Phone only: the arrows' presses. */
  readonly onStep: ((direction: 1 | -1) => void) | undefined;
}) => {
  const { colors, em, fonts } = useTheme();
  const color = active ? colors.onBrand : colors.fg2;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0.4 * em }}>
      <StepArrow
        icon="back"
        label={m.record_padding_less()}
        color={color}
        onPress={onStep === undefined ? undefined : () => onStep(-1)}
      />
      <Text
        style={{
          fontFamily: fonts.fMonoSemiBold,
          fontSize: 1.05 * em,
          color,
          minWidth: 4.5 * em,
          textAlign: "center",
        }}
      >
        {formatters().duration(minutes * 60)}
      </Text>
      <StepArrow
        icon="fwd"
        label={m.record_padding_more()}
        color={color}
        onPress={onStep === undefined ? undefined : () => onStep(1)}
      />
    </View>
  );
};

/** The status line under the options for the sheet's state, in plain words. */
const stateText = (
  plan: SheetPlan,
  padding: Padding,
  programme: SheetProgramme,
  recordings: readonly Recording[],
): string => {
  if (plan.conflict !== undefined) return conflictText(conflictWords(plan.conflict, recordings));
  switch (plan.state.kind) {
    case "record":
    case "owned":
    case "repeat":
      return m.recordings_padding({
        beforeSeconds: padding.beforeMinutes * 60,
        afterSeconds: padding.afterMinutes * 60,
      });
    case "scheduled":
      return m.status_scheduled_at({ start: new Date(programme.start) });
    case "recording":
      return m.status_recording();
    case "recorded":
      return m.guide_recorded();
    case "household":
      return m.guide_everyone_title();
    case "ended":
      return m.guide_ended_not_recorded();
  }
};

/** "Already recorded Sun 22, 15:00 on ONE" and its siblings (recording model §3.1). */
const repeatText = (status: RepeatStatus, channelName: (id: string) => string | undefined) => {
  const channel = status.channelId === undefined ? undefined : channelName(status.channelId);
  switch (status.kind) {
    case "deleted":
      return m.record_status_history({ start: status.start });
    case "scheduled":
      return channel === undefined
        ? m.record_status_scheduled({ start: status.start })
        : m.record_status_scheduled_on({ start: status.start, channel });
    case "recorded":
      return channel === undefined
        ? m.record_status_recorded({ start: status.start })
        : m.record_status_recorded_on({ start: status.start, channel });
  }
};

/** How long the sheet says a write went through before it closes. */
const doneMillis = 1200;

/** How long the TV sheet keeps its Undo row: as long as a phone toast with Undo stays. */
const undoMillis = TOAST_ACTION_MILLIS;

/** The step after a write that can be taken back: what happened and its Undo. */
interface UndoStep {
  readonly text: string;
  readonly undo: () => Promise<void>;
}

/** Props for {@link RecordSheet}. */
export interface RecordSheetProps {
  /**
   * The guide entry the sheet is about. Its description loads here (`queries.programme`);
   * openers prefetch it, so it is usually in before the sheet opens.
   */
  readonly programme: GuideEntry;
  readonly channelName: string;
  /** The viewer's library, with this profile's resume positions. */
  readonly recordings: readonly RecordingEntry[];
  readonly conflicts: readonly ScheduleConflict[];
  readonly onClose: () => void;
}

/**
 * Record options for one programme (design doc "TV · Record options"; recording model §3.1),
 * on TV a side sheet opened with long-press OK, on phone a bottom sheet opened by long-press
 * or ⋯ on a guide row. Built on the server's record options for this profile and the domain's
 * sheet state. Before a programme is recorded: record once, "Record series" or "Record every
 * “Live F1”" (kind and name from the server's `every`; none for a film), start early and keep
 * recording after, or a reminder; recording only for a profile with "Goes to" choices, into its
 * own collection when it is limited to some. An episode the viewer already has says so above
 * the rows, as a row that plays the copy when there is one to play; one a series recording left
 * out offers "Record anyway" instead. After a new series recording whose programmes would
 * scatter, a second step offers to group them; otherwise, and after grouping, the write can be
 * taken back: on TV with a focused Undo row the sheet keeps for a few seconds (a toast's button
 * cannot take focus from the guide), on phone with a toast. A scheduled
 * recording can be skipped or get other extra time; a running or finished one opens in the
 * player. Recorded for the household where this profile cannot see it: only the reminder. The
 * status line names a schedule conflict the recording is in, as the server reported it.
 */
export const RecordSheet = ({
  programme,
  channelName,
  recordings,
  conflicts,
  onClose,
}: RecordSheetProps) => {
  const { colors, em, fonts, isTV } = useTheme();
  const { runAction } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const remind = useRemind();
  const toast = useToast();
  const queries = useApiQueries();
  const now = useNow(30_000);
  const options = useQuery(queries.recordOptions(programme.id));
  const details = useQuery(queries.programme(programme.id));
  const channels = useQuery(queries.channels());
  // Undefined until the person changes it: then the server's value stays in charge.
  const [chosen, setChosen] = useState<Padding | undefined>(undefined);
  const [side, setSide] = useState<PaddingSide | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // The collection offer after "Record series", when the server has one.
  const [offer, setOffer] = useState<OfferStep | undefined>(undefined);
  // TV only: Undo of the write that just went through, as a focused row.
  const [undoStep, setUndoStep] = useState<UndoStep | undefined>(undefined);
  // The delayed close after a write; a step that follows (offer, Undo) and unmounting drop it.
  const { closeAfter, cancel: cancelClose } = useCloseTimer(onClose);

  const channelNames = useMemo(
    () => new Map((channels.data ?? []).map((channel) => [channel.id as string, channel.name])),
    [channels.data],
  );
  const sheet = sheetProgramme(programme);
  // The options as they were when a write started: the answer that comes back after it (now
  // scheduled, "Don't record") must not flash up in the moment before the sheet closes.
  const [frozenOptions, setFrozenOptions] = useState<typeof options.data>(undefined);
  const shownOptions = frozenOptions ?? options.data;
  const plan =
    shownOptions === undefined ? undefined : sheetPlan(shownOptions, sheet, conflicts, now);
  const every = plan?.every;
  const padding = chosen ?? plan?.padding;
  const offers = plan?.options ?? [];
  const first = options.isError ? "retry" : offers[0];
  const recordingId = plan?.recordingId;
  const already = plan === undefined ? undefined : repeatStatus(plan.state, sheet);
  // A scheduled recording keeps its own extra time until Save sends the change.
  const extraTimeChanged =
    plan?.state.kind === "scheduled" &&
    chosen !== undefined &&
    !paddingEquals(chosen, plan.padding);

  /** Moves one stepper, starting from the value shown the first time. */
  const step = (which: PaddingSide, direction: 1 | -1) => {
    if (padding !== undefined) setChosen(stepPadding(padding, which, direction));
  };

  // Left and right change the focused stepper; native focus stays on its row.
  const onRemote = (event: TVRemoteEvent) => {
    const press = readPress(event);
    if (side === undefined || press?.phase !== "down") return;
    if (press.key === "left") step(side, -1);
    if (press.key === "right") step(side, 1);
  };
  useTVEventHandler(onRemote);

  /** Marks everything a write changes as stale. */
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordOptionsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conflictsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.guideRepeatsAll }),
    ]).then(() => undefined);

  /** Runs one write and refreshes what it changed. */
  const write = <A, E>(effect: Effect.Effect<A, E, Api>): Promise<A> =>
    runAction(effect).then((result) => refresh().then(() => result));

  /**
   * Runs one write, says so and closes; `next` may keep the sheet open for a step that follows
   * (it answers true when it did).
   */
  const act = <A, E>(
    effect: Effect.Effect<A, E, Api>,
    done: string,
    next?: (result: A) => Promise<boolean>,
  ) => {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    setFrozenOptions(options.data);
    write(effect)
      .then((result) => {
        setMessage(done);
        return next === undefined ? false : next(result);
      })
      .then((stays) => {
        setBusy(false);
        if (stays) setFrozenOptions(undefined);
        else closeAfter(doneMillis);
      })
      .catch(() => {
        setBusy(false);
        setFrozenOptions(undefined);
        setMessage(m.guide_action_failed());
      });
  };

  /**
   * A write that can be taken back went through. TV: the sheet stays with a focused Undo row
   * for a few seconds, then closes, and focus falls back to the guide. Phone: the sheet closes
   * and a toast offers Undo.
   */
  const undoable = (text: string, undo: () => Promise<void>) => {
    if (!isTV) {
      onClose();
      toast({
        text,
        action: {
          label: m.toast_undo(),
          onPress: () => void undo().catch(() => toast({ text: m.guide_action_failed() })),
        },
      });
      return;
    }
    setOffer(undefined);
    setUndoStep({ text, undo });
    setMessage(text);
    setBusy(false);
    closeAfter(undoMillis);
  };

  /** The Undo row's press: takes the write back and closes, or says it did not work. */
  const undoNow = (current: UndoStep) => {
    if (busy) return;
    cancelClose();
    setBusy(true);
    setMessage(undefined);
    current.undo().then(onClose, () => {
      setBusy(false);
      setMessage(m.guide_action_failed());
    });
  };

  /**
   * After a new series recording: the offer step when its programmes would scatter, else Undo
   * (which deletes the series recording again).
   */
  const afterSeries = (rule: { readonly id: OfferStep["ruleId"] }) =>
    runAction(offerAfterCreate(rule.id)).then((found) => {
      if (found === undefined) {
        undoable(m.series_created(), seriesUndo(rule.id, write));
        return true;
      }
      // "Series recording added" stays in the status line under the step.
      cancelClose();
      setOffer(found);
      return true;
    });

  // Watch on a recording this profile already started asks Resume or From start first, as the
  // web does; Back from that choice returns here.
  const [choice, setChoice] = useState<RecordingChoice | undefined>(undefined);
  const closeChoice = useCallback(() => setChoice(undefined), []);
  const open = (target: PlayTarget) => {
    onClose();
    router.push({ pathname: "/player", params: playerParams(target) });
  };
  /** Plays a recording, asking Resume or From start first when this profile started it. */
  const play = (id: NonNullable<typeof recordingId>, from: "live" | "resume") => {
    const pick = pickTarget({ _tag: "Recording", recordingId: id, from }, recordings, now);
    if (pick._tag === "Choose") setChoice(pick.choice);
    else if (pick._tag === "Play") open(pick.target);
  };
  const watch = () => {
    if (recordingId === undefined) return;
    play(recordingId, plan?.state.kind === "recording" ? "live" : "resume");
  };

  if (choice !== undefined) {
    return (
      <WatchChoiceSheet
        title={programme.title}
        choice={choice}
        onPick={(option: ChoiceOption) => open(choiceTarget(choice.recordingId, option))}
        onClose={closeChoice}
      />
    );
  }

  const f = formatters();
  const start = new Date(sheet.start);
  const leaveStepper = () => setSide(undefined);
  const statusLine =
    message ??
    (options.isPending
      ? m.loading()
      : plan === undefined || padding === undefined
        ? m.guide_options_failed()
        : stateText(plan, padding, sheet, recordings));
  // A step after a write (offer, Undo) replaces the options.
  const stepShown = offer !== undefined || undoStep !== undefined;
  const warn = options.isError || (!stepShown && plan?.conflict !== undefined);
  const textStyle = { fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 } as const;

  /** The offer step's buttons, made when one is pressed. */
  const offerActions = (current: OfferStep) =>
    offerStepActions(current, {
      run: write,
      close: onClose,
      grouped: (name, undo) => undoable(m.offer_done({ name }), undo),
      failed: () => {
        setBusy(false);
        setMessage(m.guide_action_failed());
      },
    });

  const offerRows = (current: OfferStep) => (
    <>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.3 * em, color: colors.fg }}>
        {m.offer_title({ name: current.offer.name, count: current.offer.groups })}
      </Text>
      <OptionRow
        icon="series"
        title={m.offer_group()}
        hint={current.offer.examples.join(" · ")}
        preferredFocus
        onPress={() => {
          if (busy) return;
          setBusy(true);
          setMessage(undefined);
          void offerActions(current).groupThem();
        }}
      />
      <OptionRow
        icon="back"
        title={m.record_offer_not_now()}
        onPress={() => offerActions(current).notNow()}
      />
    </>
  );

  return (
    // Back closes the sheet (Sheet handles it); in the offer step that is "Not now", which
    // never declines.
    <Sheet label={programme.title} onClose={onClose}>
      <Text style={textStyle}>
        {`${channelName} · ${f.day(start)} · ${f.timeRange(start, new Date(sheet.end))}`}
      </Text>
      <Text
        numberOfLines={2}
        style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.6 * em, color: colors.fg }}
      >
        {programme.title}
      </Text>
      {stepShown ? null : details.isPending ? (
        // Two lines held while the description loads, so the rows below never move down.
        <Skeleton>
          <View style={{ gap: 0.35 * em, paddingVertical: 0.15 * em }}>
            <Bone width="92%" height={0.9 * em} />
            <Bone width="60%" height={0.9 * em} />
          </View>
        </Skeleton>
      ) : details.data?.description === undefined ? null : (
        <Text numberOfLines={2} style={textStyle}>
          {details.data.description}
        </Text>
      )}
      <View style={{ gap: 0.3 * em, marginTop: 0.6 * em }}>
        {offer !== undefined ? offerRows(offer) : null}
        {undoStep === undefined ? null : (
          <OptionRow
            icon="back"
            title={m.toast_undo()}
            hint={undoStep.text}
            preferredFocus
            onPress={() => undoNow(undoStep)}
          />
        )}
        {!stepShown && options.isError ? (
          <OptionRow
            icon="back"
            title={m.action_try_again()}
            hint={m.guide_options_failed()}
            preferredFocus
            onPress={() => void options.refetch()}
          />
        ) : null}
        {stepShown || plan === undefined ? null : (
          <>
            {already?.recordingId !== undefined ? (
              // A copy to play: the line is a row that opens it.
              <OptionRow
                icon="play"
                title={repeatText(already, (id) => channelNames.get(id))}
                hint={m.guide_play_it()}
                onFocus={leaveStepper}
                onPress={() => {
                  if (already.recordingId !== undefined) play(already.recordingId, "resume");
                }}
              />
            ) : already === undefined ? null : (
              <Text
                style={{
                  fontFamily: fonts.fUiMedium,
                  fontSize: em,
                  color: colors.fg,
                  paddingHorizontal: em,
                  paddingBottom: 0.4 * em,
                }}
              >
                {repeatText(already, (id) => channelNames.get(id))}
              </Text>
            )}
            {offers.includes("watch") ? (
              <OptionRow
                icon="play"
                title={m.player_watch()}
                hint={plan.state.kind === "recording" ? m.status_recording() : m.guide_recorded()}
                preferredFocus={first === "watch"}
                onPress={watch}
              />
            ) : null}
            {offers.includes("record") ? (
              <OptionRow
                icon="recone"
                title={m.record_this()}
                preferredFocus={first === "record"}
                onFocus={leaveStepper}
                onPress={() =>
                  act(
                    apiActions.recordProgramme(recordOnceRequest(sheet, chosen, plan.collectionId)),
                    m.record_done_once(),
                  )
                }
              />
            ) : null}
            {offers.includes("anyway") ? (
              <OptionRow
                icon="recone"
                title={m.guide_record_anyway()}
                preferredFocus={first === "anyway"}
                onFocus={leaveStepper}
                onPress={() =>
                  // A one-off owned by the viewer, no series recording behind it.
                  act(
                    apiActions.recordProgramme(recordOnceRequest(sheet, chosen, plan.collectionId)),
                    m.guide_recording_anyway({ title: programme.title }),
                  )
                }
              />
            ) : null}
            {offers.includes("every") && every !== undefined ? (
              <OptionRow
                icon="series"
                title={
                  every.kind === "series"
                    ? m.record_series()
                    : m.record_every({ title: every.name })
                }
                onFocus={leaveStepper}
                onPress={() =>
                  // A series recording keeps its own extra time, so it takes the value the
                  // steppers show; it leaves out episodes the viewer already has.
                  act(
                    apiActions.createRule(
                      seriesRule(sheet, padding ?? plan.padding, plan.collectionId),
                    ),
                    m.series_created(),
                    afterSeries,
                  )
                }
              />
            ) : null}
            {offers.includes("skip") && recordingId !== undefined ? (
              <OptionRow
                icon="rec"
                title={m.guide_skip_this()}
                hint={m.status_scheduled_at({ start })}
                preferredFocus={first === "skip"}
                onFocus={leaveStepper}
                onPress={() =>
                  act(
                    apiActions.deleteRecording(recordingId),
                    m.guide_skipped({ title: programme.title }),
                  )
                }
              />
            ) : null}
            {offers.includes("extraTime") && padding !== undefined ? (
              <>
                <OptionRow
                  icon="clock"
                  title={m.padding_before()}
                  onFocus={() => setSide("beforeMinutes")}
                  onPress={() => step("beforeMinutes", 1)}
                >
                  <Stepper
                    minutes={padding.beforeMinutes}
                    active={side === "beforeMinutes"}
                    onStep={isTV ? undefined : (direction) => step("beforeMinutes", direction)}
                  />
                </OptionRow>
                <OptionRow
                  icon="clock"
                  title={m.padding_after()}
                  onFocus={() => setSide("afterMinutes")}
                  onPress={() => step("afterMinutes", 1)}
                >
                  <Stepper
                    minutes={padding.afterMinutes}
                    active={side === "afterMinutes"}
                    onStep={isTV ? undefined : (direction) => step("afterMinutes", direction)}
                  />
                </OptionRow>
              </>
            ) : null}
            {extraTimeChanged && recordingId !== undefined && chosen !== undefined ? (
              <OptionRow
                icon="clock"
                title={m.action_save()}
                hint={m.padding_value(chosen)}
                onFocus={leaveStepper}
                onPress={() =>
                  act(
                    apiActions.updateRecording(recordingId, { padding: chosen }),
                    m.record_done_extra_time(),
                  )
                }
              />
            ) : null}
            {offers.includes("remind") ? (
              <OptionRow
                icon="bell"
                title={m.record_remind()}
                preferredFocus={first === "remind"}
                onFocus={leaveStepper}
                onPress={() => {
                  remind({
                    programmeId: programme.id,
                    channelId: programme.channelId,
                    title: programme.title,
                    start: sheet.start,
                  });
                  setMessage(m.record_done_remind());
                  closeAfter(doneMillis);
                }}
              />
            ) : null}
          </>
        )}
      </View>
      <View
        style={{
          marginTop: isTV ? "auto" : em,
          flexDirection: "row",
          alignItems: "center",
          gap: 0.6 * em,
          paddingTop: em,
          borderTopWidth: 1,
          borderColor: colors.line,
        }}
      >
        {warn ? <Icon name="warn" size={1.3 * em} color={colors.warn} /> : null}
        <Text
          accessibilityLiveRegion="polite"
          style={{ ...textStyle, flex: 1, color: warn ? colors.warnText : colors.fg2 }}
        >
          {statusLine}
        </Text>
      </View>
    </Sheet>
  );
};
