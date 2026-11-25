import {
  canEditRule,
  type ChannelId,
  collectionNameFor,
  type ConditionDraft,
  draftExtraTime,
  draftProblems,
  goesToView,
  previewStatus,
  newCondition,
  newSeriesCollection,
  previewInput,
  previewUntil,
  recordedCount,
  type SeriesDraft,
  stepPaddingMinutes,
  titlePrefix,
  toRuleInput,
  toRuleUpdate,
} from "@slipstream/domain";
import { formatters, m, pathLabels, seriesCardLine, seriesKeepKindLabel } from "@slipstream/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ScrollView,
  type ScrollViewInstance,
  Text,
  type TextInputInstance,
  View,
} from "react-native";
import { failureOf } from "../../api/failure.ts";
import { TextField } from "../../ui/TextField.tsx";
import { queryKeys } from "../../api/keys.ts";
import { apiActions } from "../../api/queries.ts";
import { useApiQueries } from "../../data/hooks.ts";
import { useSession } from "../../session/session-context.ts";
import { useTheme } from "../../theme/theme.ts";
import { OptionRow } from "../../ui/OptionRow.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useToast } from "../../ui/toast.ts";
import { useNow } from "../../ui/use-now.ts";
import { editorActions } from "./api.ts";
import { ConditionCard } from "./ConditionCard.tsx";
import { LinkButton, PickRow, ProblemLine, Section } from "./parts.tsx";
import { Hairline, StepperRow } from "../ui/settings.tsx";
import {
  ChannelSheet,
  CollectionSheet,
  type GoesToPick,
  KeepSheet,
  KindSheet,
  WeekdaySheet,
} from "../../series/Pickers.tsx";
import { Preview, type PreviewState } from "./Preview.tsx";
import { SaveBar, SaveBarSpace } from "./SaveBar.tsx";
import type { EditorData } from "../../series/use-editor-data.ts";
import { useSettled } from "../../ui/use-settled.ts";
import { seriesHref } from "../../routes.ts";

/** Which picker is open, if any. */
type Picker =
  | { readonly kind: "channels" }
  | { readonly kind: "weekdays" }
  | { readonly kind: "condition"; readonly key: number }
  | { readonly kind: "keep" }
  | { readonly kind: "collection" };

/**
 * The series recording editor on a phone (SPEC §8.6, recording model §3.2): one scrolling form
 * of grouped sections (name and channels, conditions, when, episodes, extra time, goes to and
 * keep), the live preview of what it would record, and the save bar while there are changes.
 * Pickers are bottom sheets. The draft, its checks and what it saves are the domain's, as on
 * the web.
 */
export const EditorForm = ({
  initial,
  data,
  channelNames,
  ownerName,
  timeZone,
}: {
  readonly initial: SeriesDraft;
  readonly data: EditorData;
  /** Every channel's name by id, hidden ones too. */
  readonly channelNames: ReadonlyMap<string, string>;
  readonly ownerName: string;
  /** The household's zone the preview counts days in. */
  readonly timeZone: string;
}) => {
  const { rule, channels, collections, viewer, defaults, access } = data;
  const { colors, em, fonts, radii } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const queries = useApiQueries();
  const { runAction } = useSession();
  const toast = useToast();
  const now = useNow(60_000);
  // What it started from; a re-render of the screen must not make it look changed.
  const [baseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [showProblems, setShowProblems] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<Picker | undefined>(undefined);
  const [newName, setNewName] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [until] = useState(() => previewUntil(Date.now()));
  const scroll = useRef<ScrollViewInstance>(null);
  const nameRef = useRef<TextInputInstance>(null);
  const previewY = useRef(0);
  const isNew = rule === undefined;
  const editable = rule === undefined || canEditRule(rule, viewer);

  const update = (patch: Partial<SeriesDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveProblem(undefined);
  };
  const setCondition = (key: number, patch: Partial<ConditionDraft>) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition) =>
        condition.key === key ? { ...condition, ...patch } : condition,
      ),
    }));
  const channelName = (id: ChannelId) => channelNames.get(id) ?? id;

  // One resolver for the steppers and Reset, so both show the same extra time and fallback.
  const extra = draftExtraTime(defaults, draft);
  const input = toRuleInput(draft, extra.fallback.padding);
  const problems = draftProblems(draft);
  const blocksPreview = problems.some((problem) => problem.field !== "name");
  const asked = useSettled(previewInput(input, m.series_new()), 300);
  const preview = useQuery({ ...queries.rulePreview(asked, until), enabled: !blocksPreview });
  const previewState: PreviewState = previewStatus({
    blocked: blocksPreview,
    data: preview.data,
    failed: preview.isError,
    refreshing: preview.isPlaceholderData,
  });
  // What Automatic means for this draft, the following collection and what may be picked.
  const matches = blocksPreview ? [] : (preview.data?.matches ?? []);
  const {
    options: goes,
    automaticName,
    offer,
    following,
    allowed,
    chosen,
  } = goesToView({
    ruleId: rule?.id,
    collectionId: draft.collectionId,
    collections,
    access,
    mayCreateCollections: data.mayEditCollections,
    preview: blocksPreview ? undefined : preview.data,
    labels: pathLabels(),
  });
  const automaticLabel =
    offer !== undefined
      ? m.series_goes_scattered({ count: offer.groups })
      : automaticName === undefined
        ? m.series_automatic()
        : m.series_automatic_named({ name: automaticName });
  const goesToValue =
    newName !== undefined
      ? m.series_new_collection()
      : chosen === undefined
        ? automaticLabel
        : chosen.id === following?.id
          ? m.series_goes_follows({ collection: chosen.name })
          : chosen.name;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const nameProblem = showProblems && problems.some((problem) => problem.field === "name");
  const matcherProblem = showProblems
    ? problems.find((problem) => problem.field === "matcher")
    : undefined;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
    ]);

  const onSave = () => {
    if (problems.length > 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setShowProblems(true);
      if (problems.some((problem) => problem.field === "name")) {
        scroll.current?.scrollTo({ y: 0, animated: true });
        nameRef.current?.focus();
      }
      return;
    }
    setSaveProblem(undefined);
    setBusy(true);
    const saved =
      rule === undefined
        ? runAction(apiActions.createRule(input))
        : runAction(
            apiActions.updateRule(rule.id, toRuleUpdate(draft, baseline, extra.fallback.padding)),
          );
    saved
      .then(async (result) => {
        await refresh();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({ text: isNew ? m.series_created() : m.series_saved() });
        // Back to the series recording's page: a new one opens in place of the editor.
        if (isNew) router.replace(seriesHref(result.id));
        else router.back();
      })
      .catch((error: unknown) => {
        setBusy(false);
        setSaveProblem(
          failureOf(error).tag === "Offline"
            ? m.series_problem_offline()
            : m.series_problem_generic(),
        );
      });
  };

  const pickGoesTo = (pick: GoesToPick) => {
    setPicker(undefined);
    if (pick.kind === "new") {
      setNewName(collectionNameFor(draft));
      return;
    }
    setNewName(undefined);
    update({ collectionId: pick.kind === "automatic" ? undefined : pick.id });
  };

  const createCollection = () => {
    const name = (newName ?? "").trim() || collectionNameFor(draft);
    if (name === "") return;
    const firstMatch = matches.find((match) => match.skip === undefined)?.programme;
    const [only, ...more] = draft.channels;
    setCreating(true);
    runAction(
      editorActions.createCollection(
        newSeriesCollection(name, {
          title: firstMatch?.title ?? titlePrefix(draft),
          channelId: more.length === 0 ? only : undefined,
        }),
      ),
    )
      .then(async (collection) => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.collections });
        update({ collectionId: collection.id });
        setNewName(undefined);
        toast({ text: m.series_nc_created_named({ name: collection.name }) });
      })
      .catch(() => toast({ text: m.series_nc_failed() }))
      .finally(() => setCreating(false));
  };

  const pickedCondition =
    picker?.kind === "condition"
      ? draft.conditions.find((condition) => condition.key === picker.key)
      : undefined;
  const secondary = { fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg2 } as const;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        // iOS: the keyboard insets the form, so the box being typed in scrolls into view.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: em, paddingTop: 0.4 * em, gap: 1.3 * em }}
      >
        {following !== undefined && !data.mayEditCollections && editable ? (
          <View
            style={{
              flexDirection: "row",
              gap: 0.6 * em,
              padding: em,
              borderRadius: radii.rL,
              backgroundColor: colors.surface,
            }}
          >
            <Icon name="warn" size={1.1 * em} color={colors.fg2} />
            <Text style={[secondary, { flex: 1 }]}>
              {m.series_linked_notice({ collection: following.name })}
            </Text>
          </View>
        ) : null}

        <Section title={m.series_section_name()}>
          <View style={{ paddingHorizontal: em, paddingTop: 0.8 * em, gap: 0.3 * em }}>
            <TextField
              autoCapitalize="sentences"
              inputRef={nameRef}
              label={m.field_name()}
              placeholder={m.series_name_placeholder()}
              value={draft.name}
              editable={editable}
              invalid={nameProblem}
              returnKeyType="done"
              onChangeText={(name) => update({ name })}
            />
            <ProblemLine text={nameProblem ? m.series_problem_name() : undefined} />
          </View>
          <Hairline />
          <PickRow
            label={m.channels_heading()}
            value={
              draft.channels.length === 0
                ? m.series_any_channel()
                : seriesCardLine(draft.channels.map(channelName), [])
            }
            disabled={!editable}
            onPress={() => setPicker({ kind: "channels" })}
          />
        </Section>

        <Section title={m.series_section_conditions()}>
          {draft.conditions.map((condition, index) => {
            const broken = problems.find(
              (problem) => problem.field === "condition" && problem.index === index,
            );
            return (
              <View key={condition.key}>
                {index === 0 ? null : <Hairline />}
                <ConditionCard
                  condition={condition}
                  editable={editable}
                  problem={
                    broken?.field === "condition"
                      ? m.series_problem_regex({ pattern: broken.pattern })
                      : undefined
                  }
                  onKind={() => setPicker({ kind: "condition", key: condition.key })}
                  onChange={(patch) => setCondition(condition.key, patch)}
                  onRemove={() =>
                    update({
                      conditions: draft.conditions.filter((item) => item.key !== condition.key),
                    })
                  }
                />
              </View>
            );
          })}
          {draft.conditions.length === 0 ? null : <Hairline />}
          {editable ? (
            <LinkButton
              label={m.series_add_condition()}
              icon="plus"
              onPress={() =>
                update({
                  conditions: [...draft.conditions, newCondition(draft.conditions, "Contains")],
                })
              }
            />
          ) : null}
          <View style={{ paddingHorizontal: em, paddingBottom: 0.4 * em }}>
            <ProblemLine
              text={
                matcherProblem === undefined
                  ? undefined
                  : matcherProblem.kind === "everything"
                    ? m.series_problem_everything()
                    : m.series_problem_duration()
              }
            />
          </View>
        </Section>

        <Section title={m.series_section_when()}>
          <PickRow
            label={m.series_weekdays()}
            value={
              draft.weekdays.length === 0
                ? m.series_phone_every_day()
                : m.series_day_list({ days: draft.weekdays })
            }
            disabled={!editable}
            onPress={() => setPicker({ kind: "weekdays" })}
          />
        </Section>

        <Section title={m.series_section_episodes()}>
          <OptionRow
            title={m.series_episodes_new()}
            selected={draft.skipRepeats}
            onPress={editable ? () => update({ skipRepeats: true }) : undefined}
          />
          <OptionRow
            title={m.series_episodes_every()}
            selected={!draft.skipRepeats}
            onPress={editable ? () => update({ skipRepeats: false }) : undefined}
          />
        </Section>

        <Section title={m.series_section_extra()}>
          <StepperRow
            title={m.padding_before()}
            value={m.series_minutes({ minutes: extra.padding.beforeMinutes })}
            disabled={!editable}
            onStep={(direction) => {
              update({
                padding: {
                  ...extra.padding,
                  beforeMinutes: stepPaddingMinutes(extra.padding.beforeMinutes, direction),
                },
              });
            }}
          />
          <Hairline />
          <StepperRow
            title={m.padding_after()}
            value={m.series_minutes({ minutes: extra.padding.afterMinutes })}
            disabled={!editable}
            onStep={(direction) => {
              update({
                padding: {
                  ...extra.padding,
                  afterMinutes: stepPaddingMinutes(extra.padding.afterMinutes, direction),
                },
              });
            }}
          />
          {extra.overridesDefault && editable ? (
            <>
              <Hairline />
              <LinkButton label={m.action_reset()} onPress={() => update({ padding: undefined })} />
            </>
          ) : null}
        </Section>

        <Section title={m.series_section_goes()}>
          <PickRow
            label={m.library_kind_collection()}
            value={goesToValue}
            disabled={!editable || goes === undefined}
            onPress={() => setPicker({ kind: "collection" })}
          />
          {newName === undefined ? null : (
            <View style={{ paddingHorizontal: em, paddingBottom: 0.8 * em, gap: 0.6 * em }}>
              <Text style={secondary}>{m.library_new_collection()}</Text>
              <TextField
                placeholder=""
                autoCapitalize="sentences"
                label={m.library_new_collection()}
                value={newName}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onChangeText={setNewName}
                onSubmitEditing={createCollection}
              />
              <View style={{ flexDirection: "row", gap: 0.6 * em }}>
                <FocusButton
                  label={m.series_nc_create()}
                  icon="check"
                  variant="primary"
                  size={0.9}
                  disabled={creating}
                  onPress={createCollection}
                />
                <FocusButton
                  label={m.action_cancel()}
                  variant="ghost"
                  size={0.9}
                  onPress={() => setNewName(undefined)}
                />
              </View>
            </View>
          )}
          <Hairline />
          <PickRow
            label={m.library_editor_keep()}
            value={seriesKeepKindLabel(draft.keep)}
            disabled={!editable}
            onPress={() => setPicker({ kind: "keep" })}
          />
          {draft.keep === "KeepAll" ? null : (
            <>
              <Hairline />
              <StepperRow
                title={draft.keep === "KeepDays" ? m.series_keep_days() : m.series_keep_count()}
                value={formatters().number(draft.keepCount)}
                disabled={!editable}
                onStep={(direction) => {
                  update({ keepCount: Math.max(1, Math.round(draft.keepCount) + direction) });
                }}
              />
            </>
          )}
        </Section>

        <View
          onLayout={(event) => {
            previewY.current = event.nativeEvent.layout.y;
          }}
        >
          <Preview
            state={previewState}
            conditions={asked.matcher.title}
            channelName={channelName}
            isNew={isNew}
            timeZone={timeZone}
            now={now}
          />
        </View>
        <SaveBarSpace />
      </ScrollView>

      {isNew || dirty || !editable ? (
        <SaveBar
          isNew={isNew}
          editable={editable}
          ownerLine={m.series_read_only_bar({ owner: ownerName })}
          count={previewState.kind === "ready" ? recordedCount(matches) : undefined}
          busy={busy}
          problem={saveProblem}
          onSave={onSave}
          onCancel={() => router.back()}
          onPreview={() => scroll.current?.scrollTo({ y: previewY.current, animated: true })}
        />
      ) : null}

      {picker?.kind === "channels" ? (
        <ChannelSheet
          channels={channels}
          value={draft.channels}
          onChange={(value) => update({ channels: value })}
          onClose={() => setPicker(undefined)}
        />
      ) : picker?.kind === "weekdays" ? (
        <WeekdaySheet
          value={draft.weekdays}
          onChange={(weekdays) => update({ weekdays })}
          onClose={() => setPicker(undefined)}
        />
      ) : pickedCondition !== undefined ? (
        <KindSheet
          value={pickedCondition.kind}
          onPick={(kind) => {
            setCondition(pickedCondition.key, { kind });
            setPicker(undefined);
          }}
          onClose={() => setPicker(undefined)}
        />
      ) : picker?.kind === "keep" ? (
        <KeepSheet
          value={draft.keep}
          onPick={(keep) => {
            update({ keep });
            setPicker(undefined);
          }}
          onClose={() => setPicker(undefined)}
        />
      ) : picker?.kind === "collection" ? (
        <CollectionSheet
          value={draft.collectionId}
          automaticLabel={automaticLabel}
          showAutomatic={goes?.automatic !== false}
          collections={allowed}
          following={following}
          mayCreate={goes?.newCollection === true}
          onPick={pickGoesTo}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
    </View>
  );
};
