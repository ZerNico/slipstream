import type { RecordingEntry } from "@slipstream/api";
import {
  type Collection,
  type DraftProblem,
  draftExtraTime,
  draftFromRule,
  draftProblems,
  epochMs,
  goesToOptions,
  type SeriesDraft,
  toRuleUpdate,
} from "@slipstream/domain";
import {
  formatters,
  m,
  pathLabels,
  seriesCardLine,
  seriesConditionKindLabel,
  seriesKeepKindLabel,
} from "@slipstream/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { queryKeys } from "../../api/keys.ts";
import { apiActions } from "../../api/queries.ts";
import { cardMeta, libraryCard } from "../../data/library.ts";
import { nextLine, type SeriesItem, useSeries } from "../../series/use-series.ts";
import { ChannelSheet, CollectionSheet, WeekdaySheet } from "../../series/Pickers.tsx";
import { type EditorData, useEditorData } from "../../series/use-editor-data.ts";
import { RecordingSheet } from "../../recordings/RecordingSheet.tsx";
import { useSession } from "../../session/session-context.ts";
import { useTheme } from "../../theme/theme.ts";
import { Chip } from "../../ui/Chip.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import type { IconName } from "../../ui/Icon.tsx";
import { Bone } from "../../ui/Skeleton.tsx";
import { useToast } from "../../ui/toast.ts";
import { useNow } from "../../ui/use-now.ts";
import { CardRow } from "../CardRow.tsx";
import { useReturnFocus } from "../library/use-tv-navigation.ts";
import { OptionRow } from "../../ui/OptionRow.tsx";
import { PhoneHandoff } from "../PhoneHandoff.tsx";
import { Rail, RailContent } from "../Rail.tsx";
import { CARD_LIFT_ROOM } from "../rail-metrics.ts";
import { RecordingCard } from "../RecordingCard.tsx";
import { ListBones, TvSkeleton, TvStatus, TvTitle } from "../TvStatus.tsx";
import { DeleteSheet, EpisodesSheet, ExtraTimeSheet, KeepSheet } from "./SeriesSheets.tsx";
import { SeriesToggle } from "./SeriesToggle.tsx";
import { editSeriesHref } from "../../routes.ts";

/** A setting's side sheet. */
type SettingSheet = "channels" | "weekdays" | "episodes" | "extra" | "goes" | "keep";

/** Which side sheet is open over the page, if any. */
type Open = SettingSheet | "delete" | "handoff" | { readonly recordingId: RecordingEntry["id"] };

/** Focus keys of the page's buttons and rows, apart from recording ids. */
const TOGGLE_KEY = "toggle";
const DELETE_KEY = "delete";
const HANDOFF_KEY = "handoff";
const settingSheets: readonly SettingSheet[] = [
  "channels",
  "weekdays",
  "episodes",
  "extra",
  "goes",
  "keep",
];
const PAGE_KEYS: readonly string[] = [TOGGLE_KEY, DELETE_KEY, HANDOFF_KEY, ...settingSheets];

/** A section of the page: its heading and what is under it. */
const Section = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => {
  const { colors, em, fonts, radii } = useTheme();
  return (
    <View style={{ gap: 0.5 * em, maxWidth: 48 * em, paddingLeft: CARD_LIFT_ROOM * em }}>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.25 * em, color: colors.fg }}>
        {title}
      </Text>
      <View
        style={{
          borderRadius: radii.rL,
          backgroundColor: colors.surface,
          padding: 0.4 * em,
          gap: 0.2 * em,
        }}
      >
        {children}
      </View>
    </View>
  );
};

/** One titled row of episode cards: each named by its episode when the guide gives one. */
const Shelf = ({
  title,
  entries,
  card,
  target,
  onOpen,
}: {
  readonly title: string;
  readonly entries: readonly RecordingEntry[];
  readonly card: (entry: RecordingEntry) => {
    readonly meta: string;
    readonly progress: number;
    readonly running: boolean;
  };
  /** What asks for focus now (useReturnFocus). */
  readonly target: string | undefined;
  readonly onOpen: (entry: RecordingEntry) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ gap: 0.4 * em }}>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.25 * em,
          color: colors.fg,
          paddingLeft: CARD_LIFT_ROOM * em,
        }}
      >
        {title}
      </Text>
      <CardRow
        items={entries}
        keyOf={(entry) => entry.id}
        renderCard={(entry) => {
          const shown = card(entry);
          return (
            <RecordingCard
              subject={entry}
              title={entry.subtitle ?? entry.title}
              meta={shown.meta}
              progress={shown.progress}
              badge={shown.running ? <Chip label={m.status_recording()} tone="rec" /> : undefined}
              preferredFocus={target === entry.id}
              onPress={() => onOpen(entry)}
            />
          );
        }}
      />
    </View>
  );
};

/** What a problem that stops saving says. */
const problemText = (problem: DraftProblem): string => {
  switch (problem.field) {
    case "name":
      return m.series_problem_name();
    case "matcher":
      return problem.kind === "everything"
        ? m.series_problem_everything()
        : m.series_problem_duration();
    case "condition":
      return m.series_problem_regex({ pattern: problem.pattern });
  }
};

/** The page once the series recording and what its settings read are in. */
const SeriesPage = ({
  item,
  data,
  names,
  setEnabled,
  remove,
}: {
  readonly item: SeriesItem;
  readonly data: EditorData;
  readonly names: ReadonlyMap<string, string>;
  readonly setEnabled: (enabled: boolean) => void;
  readonly remove: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { runAction } = useSession();
  const toast = useToast();
  const now = useNow(60_000);
  const { rule, mine } = item;
  const { collections, access, defaults } = data;
  // Undefined until something changes; Save sends it, Cancel drops it.
  const [draft, setDraft] = useState<SeriesDraft | undefined>(undefined);
  const [open, setOpen] = useState<Open | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const current = draft ?? draftFromRule(rule);
  const dirty = draft !== undefined;
  const extra = draftExtraTime(defaults, current);
  const all = [...item.upcoming, ...item.recorded];
  // Focus starts on Pause (on the first setting for someone else's); closing a sheet brings it
  // back to the row that opened it.
  const { target, opening, focus } = useReturnFocus({
    keys: [...PAGE_KEYS, ...all.map((entry) => entry.id)],
    first: mine ? TOGGLE_KEY : "channels",
    covered: open !== undefined,
  });
  const openSheet = (which: Open, key: string) => {
    opening(key);
    setOpen(which);
  };
  const close = () => setOpen(undefined);
  const update = (patch: Partial<SeriesDraft>) => {
    setDraft({ ...current, ...patch });
    setProblem(undefined);
  };
  const channelName = (id: string) => names.get(id) ?? id;

  // Goes to: Automatic and the collections this profile may record into (SPEC §7.8). A new
  // collection needs a name typed, so on TV that stays on the phone.
  const following = collections.find((collection) => collection.follows?.ruleId === rule.id);
  const goes = goesToOptions(
    access,
    collections.map((collection) => collection.id),
    { mayCreateCollections: false },
  );
  const allowed: readonly Collection[] = collections.filter(
    (collection) =>
      goes === undefined ||
      goes.collectionIds.includes(collection.id) ||
      collection.id === current.collectionId ||
      collection.id === following?.id,
  );
  const chosen = collections.find((collection) => collection.id === current.collectionId);
  const goesToValue =
    chosen === undefined
      ? m.series_automatic()
      : chosen.id === following?.id
        ? m.series_goes_follows({ collection: chosen.name })
        : chosen.name;

  const save = () => {
    if (draft === undefined || busy) return;
    const first = draftProblems(draft)[0];
    if (first !== undefined) {
      setProblem(problemText(first));
      return;
    }
    setBusy(true);
    setProblem(undefined);
    // On and off switch on their own; Save never undoes a switch made meanwhile.
    const changes = toRuleUpdate(
      { ...draft, enabled: rule.enabled },
      { skipRepeats: rule.skipRepeats },
      extra.fallback.padding,
    );
    runAction(apiActions.updateRule(rule.id, changes))
      .then(() =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
          queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
        ]),
      )
      .then(() => {
        setDraft(undefined);
        setBusy(false);
        // Save and Cancel can no longer take focus: Pause takes it.
        focus(TOGGLE_KEY);
        toast({ text: m.series_saved() });
      })
      .catch(() => {
        setBusy(false);
        setProblem(m.series_problem_generic());
      });
  };

  const textStyle = { fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 } as const;
  const settingRow = (which: SettingSheet, icon: IconName, title: string, value: string) => (
    <OptionRow
      icon={icon}
      title={title}
      hint={value}
      preferredFocus={target === which}
      onPress={mine ? () => openSheet(which, which) : undefined}
    />
  );
  const opened =
    typeof open === "object" ? all.find((entry) => entry.id === open.recordingId) : undefined;
  const labels = pathLabels();
  const conditions = current.conditions;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Rail current="recordings" />
      <RailContent>
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{
            paddingLeft: (3 - CARD_LIFT_ROOM) * em,
            paddingRight: 4 * em,
            paddingTop: 2.7 * em,
            paddingBottom: 3 * em,
            gap: 2 * em,
          }}
        >
          <View style={{ gap: 0.45 * em, paddingLeft: CARD_LIFT_ROOM * em }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: em }}>
              <TvTitle>{rule.name}</TvTitle>
              {rule.enabled ? null : <Chip label={m.series_paused()} tone="outline" size={0.9} />}
            </View>
            <Text numberOfLines={2} style={{ ...textStyle, fontSize: 1.1 * em, maxWidth: 60 * em }}>
              {seriesCardLine(current.channels.map(channelName), current.weekdays)}
            </Text>
            <Text numberOfLines={1} style={{ ...textStyle, color: colors.fg3 }}>
              {[nextLine(item, now), m.series_card_recorded({ count: item.recorded.length })].join(
                " · ",
              )}
            </Text>
            {mine ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 0.6 * em,
                  marginTop: 0.8 * em,
                }}
              >
                <SeriesToggle
                  rule={rule}
                  preferredFocus={target === TOGGLE_KEY}
                  onToggle={setEnabled}
                />
                {/* Raised, not amber: on TV amber is the focus alone. */}
                <FocusButton
                  label={m.action_save()}
                  icon="check"
                  disabled={!dirty || busy}
                  onPress={save}
                />
                <FocusButton
                  label={m.action_cancel()}
                  variant="ghost"
                  disabled={!dirty || busy}
                  onPress={() => {
                    setDraft(undefined);
                    setProblem(undefined);
                    focus(TOGGLE_KEY);
                  }}
                />
                <FocusButton
                  label={m.action_delete()}
                  icon="delete"
                  variant="ghost"
                  preferredFocus={target === DELETE_KEY}
                  onPress={() => openSheet("delete", DELETE_KEY)}
                />
                {/* Always there, so a problem appearing moves nothing. */}
                <Text
                  accessibilityLiveRegion="polite"
                  numberOfLines={2}
                  style={{ ...textStyle, flex: 1, color: colors.liveText }}
                >
                  {problem ?? ""}
                </Text>
              </View>
            ) : null}
          </View>

          <Section title={m.series_section_name()}>
            {settingRow(
              "channels",
              "tv",
              m.channels_heading(),
              current.channels.length === 0
                ? m.series_any_channel()
                : seriesCardLine(current.channels.map(channelName), []),
            )}
            {settingRow(
              "weekdays",
              "clock",
              m.series_weekdays(),
              current.weekdays.length === 0
                ? m.series_phone_every_day()
                : m.series_day_list({ days: current.weekdays }),
            )}
            {settingRow(
              "episodes",
              "series",
              m.series_section_episodes(),
              current.skipRepeats ? m.series_episodes_new() : m.series_episodes_every(),
            )}
            {settingRow("extra", "clock", m.series_section_extra(), m.padding_value(extra.padding))}
            {goes === undefined ? (
              <OptionRow
                icon="rec"
                title={m.series_section_goes()}
                hint={goesToValue}
                preferredFocus={target === "goes"}
              />
            ) : (
              settingRow("goes", "rec", m.series_section_goes(), goesToValue)
            )}
            {settingRow(
              "keep",
              "server",
              m.library_editor_keep(),
              current.keep === "KeepAll"
                ? seriesKeepKindLabel(current.keep)
                : `${seriesKeepKindLabel(current.keep)} · ${formatters().number(current.keepCount)}`,
            )}
          </Section>

          {/* Typed words and patterns: shown here, changed on the phone. */}
          <Section title={m.series_section_conditions()}>
            {conditions.map((condition) => (
              <View
                key={condition.key}
                style={{ paddingHorizontal: em, paddingVertical: 0.5 * em }}
              >
                <Text
                  style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.15 * em, color: colors.fg }}
                >
                  {seriesConditionKindLabel(condition.kind)}
                </Text>
                <Text numberOfLines={2} style={{ ...textStyle, color: colors.fg3 }}>
                  {condition.kind === "Regex"
                    ? condition.pattern
                    : m.series_channel_list({ names: condition.values })}
                </Text>
              </View>
            ))}
            {mine ? (
              <OptionRow
                icon="more"
                title={m.series_tv_edit_on_phone()}
                hint={m.series_tv_conditions_text()}
                preferredFocus={target === HANDOFF_KEY}
                onPress={() => openSheet("handoff", HANDOFF_KEY)}
              />
            ) : null}
          </Section>

          {item.upcoming.length === 0 ? null : (
            <Shelf
              title={m.library_title_scheduled()}
              entries={item.upcoming}
              card={(entry) => ({
                meta: m.recordings_slot({
                  start: new Date(epochMs(entry.start)),
                  end: new Date(epochMs(entry.end)),
                }),
                progress: 0,
                running: false,
              })}
              target={target}
              onOpen={(entry) => openSheet({ recordingId: entry.id }, entry.id)}
            />
          )}
          {item.recorded.length === 0 ? null : (
            <Shelf
              title={m.series_card_recorded({ count: item.recorded.length })}
              entries={item.recorded}
              card={(entry) => {
                const shown = libraryCard(entry, names, labels);
                return { meta: cardMeta(shown), progress: shown.progress, running: shown.running };
              }}
              target={target}
              onOpen={(entry) => openSheet({ recordingId: entry.id }, entry.id)}
            />
          )}
        </ScrollView>
      </RailContent>

      {open === "channels" ? (
        <ChannelSheet
          channels={data.channels}
          value={current.channels}
          onChange={(channels) => update({ channels })}
          onClose={close}
        />
      ) : open === "weekdays" ? (
        <WeekdaySheet
          value={current.weekdays}
          onChange={(weekdays) => update({ weekdays })}
          onClose={close}
        />
      ) : open === "episodes" ? (
        <EpisodesSheet
          skipRepeats={current.skipRepeats}
          onPick={(skipRepeats) => {
            update({ skipRepeats });
            close();
          }}
          onClose={close}
        />
      ) : open === "extra" ? (
        <ExtraTimeSheet
          padding={extra.padding}
          overridesDefault={extra.overridesDefault}
          onChange={(padding) => update({ padding })}
          onClose={close}
        />
      ) : open === "goes" ? (
        <CollectionSheet
          value={current.collectionId}
          automaticLabel={m.series_automatic()}
          showAutomatic={goes?.automatic !== false}
          collections={allowed}
          following={following}
          mayCreate={false}
          onPick={(pick) => {
            if (pick.kind === "collection") update({ collectionId: pick.id });
            if (pick.kind === "automatic") update({ collectionId: undefined });
            close();
          }}
          onClose={close}
        />
      ) : open === "keep" ? (
        <KeepSheet
          keep={current.keep}
          count={current.keepCount}
          onChange={update}
          onClose={close}
        />
      ) : open === "delete" ? (
        <DeleteSheet
          name={rule.name}
          onDelete={() => {
            remove();
            router.back();
          }}
          onClose={close}
        />
      ) : open === "handoff" ? (
        <PhoneHandoff title={rule.name} path={editSeriesHref(rule.id)} onClose={close} />
      ) : opened === undefined ? null : (
        <RecordingSheet
          entry={opened}
          entries={all}
          channelName={names.get(opened.channelId) ?? ""}
          onClose={close}
        />
      )}
    </View>
  );
};

/**
 * One series recording on TV: its name, channels and days, what comes next; Pause or Resume;
 * the settings a remote can change, each a row that opens a side sheet (channels, weekdays,
 * which episodes, extra time, where it goes, keep), saved together with Save; its conditions
 * read-only with "Edit on your phone"; what it has scheduled and recorded as cards; and Delete
 * with a confirm step. The draft and what it saves are the domain's series editor, as on the
 * phone and the web.
 */
export const TvSeriesDetail = ({ id }: { readonly id: string }) => {
  const { em } = useTheme();
  const series = useSeries();
  const editor = useEditorData(id);
  if (series.loading || editor.loading) {
    return (
      <TvSkeleton current="recordings">
        <View style={{ gap: 0.6 * em, paddingLeft: CARD_LIFT_ROOM * em }}>
          <Bone width={30 * em} height={3.4 * em} />
          <Bone width={20 * em} height={1.3 * em} />
          <Bone width={16 * em} height={1.1 * em} />
        </View>
        <ListBones rows={4} />
      </TvSkeleton>
    );
  }
  const item = series.items.find((candidate) => candidate.rule.id === id);
  // A failed refresh keeps the page that loaded, as the other TV screens do.
  if (item === undefined && (series.error !== null || editor.error !== null)) {
    return (
      <TvStatus
        current="recordings"
        title={m.series_error_title()}
        onRetry={() => {
          series.retry();
          editor.retry();
        }}
      />
    );
  }
  if (item === undefined) return <TvStatus current="recordings" title={m.series_not_found()} />;
  return (
    <SeriesPage
      item={item}
      data={editor.data}
      names={series.names}
      setEnabled={(enabled) => series.setEnabled(item.rule, enabled)}
      remove={() => void series.remove(item.rule)}
    />
  );
};
