import type { SourceCheck } from "@slipstream/api";
import {
  addressField,
  type SourceDraft,
  sourceDraftOf,
  sourceDraftProblems,
  sourceEdit,
  sourceInput,
  type SourceView,
  hasStreamsToPick,
} from "@slipstream/domain";
import { m, sourceProblemTexts } from "@slipstream/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sourceProblem } from "../../../api/failure.ts";
import { readProblem } from "../../../api/failure.ts";
import { ActionRow, FormField, Panel } from "../../ui/settings.tsx";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { useApiQueries } from "../../../data/hooks.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { useToast } from "../../../ui/toast.ts";
import { BackHeader } from "../../BackHeader.tsx";
import { sourceActions } from "./api.ts";
import { ResultNote } from "./parts.tsx";
import { FormSkeleton } from "./SourcesSkeletons.tsx";
import { useRefreshAfterChange } from "./use-sources.ts";
import { SwitchRow } from "../users/parts.tsx";
import { streamPickerHref, usePickerQueries } from "./use-stream-picker.ts";

/** What the last test answered. */
type TestOutcome =
  | { readonly kind: "found"; readonly check: SourceCheck }
  | { readonly kind: "failed"; readonly text: string };

/**
 * The form itself, as the web's: name, playlist and guide addresses, streams at once and kept
 * for recordings. Problems show once Save or Test was pressed. A new source can be tested
 * before it is saved; a stored one can be deleted (with a native confirm). Addresses with
 * credentials are write-only: they stay as stored unless something new is typed.
 */
const SourceFormBody = ({ source }: { readonly source: SourceView | undefined }) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const client = useQueryClient();
  const pickerQueries = usePickerQueries();
  const playlistStored =
    source?.config._tag === "M3u" ? addressField(source.config.playlistUrl) : undefined;
  const [draft, setDraft] = useState<SourceDraft>(() => sourceDraftOf(source));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | undefined>(undefined);
  const [test, setTest] = useState<TestOutcome | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const errors = sourceProblemTexts(
    sourceDraftProblems(draft, { playlist: playlistStored?.writeOnly ?? false }),
  );
  const valid = Object.keys(errors).length === 0;
  const shown = (error: string | undefined) => (touched ? error : undefined);
  const set = (patch: Partial<SourceDraft>) => {
    setDraft((before) => ({ ...before, ...patch }));
    setTest(undefined);
    setSaveError(undefined);
  };

  const done = (text: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast({ text });
    router.back();
  };
  const save = () => {
    setTouched(true);
    if (!valid || busy !== undefined) return;
    setBusy("save");
    const name = draft.name.trim();
    // A new source is read at once: a small playlist's streams are channels by then, a big
    // one's wait in the picker.
    const readNew = async (id: SourceView["id"]) => {
      try {
        await runAction(sourceActions.refreshSource(id));
      } catch {
        await refreshAfter("sources");
        done(m.toast_saved_named({ name }));
        return;
      }
      await refreshAfter("sources");
      const groups = await client.fetchQuery(pickerQueries.groups(id));
      const added = groups.reduce((sum, group) => sum + group.added, 0);
      if (hasStreamsToPick(groups)) {
        router.replace(streamPickerHref(id));
        return;
      }
      done(m.picker_done({ created: added, joined: 0 }));
    };
    const write =
      source === undefined
        ? runAction(sourceActions.createSource(sourceInput(draft))).then((created) =>
            readNew(created.id),
          )
        : runAction(sourceActions.updateSource(source.id, sourceEdit(source, draft)))
            .then(() => refreshAfter("sources"))
            .then(() => done(m.toast_saved_named({ name })));
    write.catch((error: unknown) => {
      setSaveError(sourceProblem(error));
      setBusy(undefined);
    });
  };
  const runTest = () => {
    setTouched(true);
    if (!valid || busy !== undefined) return;
    setBusy("test");
    runAction(sourceActions.testSource(sourceInput(draft)))
      .then((check) => setTest({ kind: "found", check }))
      .catch((error: unknown) => setTest({ kind: "failed", text: sourceProblem(error) }))
      .finally(() => setBusy(undefined));
  };
  const askDelete = (stored: SourceView) =>
    Alert.alert(m.source_delete_title({ name: stored.name }), m.source_delete_text(), [
      { text: m.action_cancel(), style: "cancel" },
      {
        text: m.action_delete(),
        style: "destructive",
        onPress: () => {
          runAction(sourceActions.deleteSource(stored.id))
            .then(() => refreshAfter("sources"))
            .then(() => {
              toast({ text: m.toast_deleted_named({ name: stored.name }) });
              router.back();
            })
            .catch(() => toast({ text: m.state_not_saved() }));
        },
      },
    ]);

  return (
    <>
      <BackHeader
        title={source === undefined ? m.source_add() : m.action_edit_named({ name: source.name })}
        action={
          <FocusButton
            label={source === undefined ? m.source_add() : m.action_save()}
            variant="primary"
            size={0.85}
            disabled={busy !== undefined}
            onPress={save}
          />
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: em, paddingBottom: insets.bottom + 2 * em }}
      >
        <FormField
          label={m.field_name()}
          value={draft.name}
          onChangeText={(name) => set({ name })}
          error={shown(errors.name)}
          autoFocus={source === undefined}
          returnKeyType="next"
        />
        <FormField
          label={m.source_playlist_url()}
          value={draft.playlist}
          onChangeText={(playlist) => set({ playlist })}
          keyboardType="url"
          placeholder={m.source_playlist_placeholder()}
          hint={
            playlistStored?.writeOnly === true && source?.config._tag === "M3u"
              ? m.source_url_keep_hint({ url: source.config.playlistUrl.url })
              : undefined
          }
          error={shown(errors.playlist)}
        />
        <FormField
          label={m.source_guide_url()}
          value={draft.guide}
          onChangeText={(guide) => set({ guide })}
          keyboardType="url"
          placeholder={m.source_guide_placeholder()}
          error={shown(errors.guide)}
        />
        <View style={{ flexDirection: "row", gap: 0.8 * em }}>
          <View style={{ flex: 1 }}>
            <FormField
              label={m.source_max_streams()}
              value={draft.limit}
              onChangeText={(limit) => set({ limit })}
              keyboardType="number-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <FormField
              label={m.source_kept()}
              value={draft.kept}
              onChangeText={(kept) => set({ kept })}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <View style={{ marginHorizontal: -em, paddingBottom: 0.8 * em }}>
          <SwitchRow
            title={m.source_auto_add()}
            value={draft.autoAddNew ?? false}
            onChange={(autoAddNew) => set({ autoAddNew })}
          />
          <Text
            style={{
              marginTop: -0.3 * em,
              paddingHorizontal: em,
              fontFamily: fonts.fUi,
              fontSize: 0.85 * em,
              color: colors.fg3,
            }}
          >
            {m.source_auto_add_hint()}
          </Text>
        </View>
        {source === undefined ? (
          <View style={{ gap: 0.6 * em }}>
            {test === undefined ? null : test.kind === "found" ? (
              <ResultNote tone="ok">
                {m.source_test_result({
                  streams: test.check.streams,
                  programmes: test.check.programmes,
                  unmapped: test.check.unmappedStreams,
                })}
              </ResultNote>
            ) : (
              <ResultNote tone="error">{test.text}</ResultNote>
            )}
            <FocusButton
              label={m.source_test()}
              icon="check"
              size={0.9}
              disabled={busy !== undefined}
              onPress={runTest}
            />
          </View>
        ) : null}
        {saveError === undefined ? null : (
          <View style={{ paddingTop: 0.8 * em }}>
            <ResultNote tone="error">{saveError}</ResultNote>
          </View>
        )}
      </ScrollView>
      {source === undefined ? null : (
        <View style={{ paddingBottom: insets.bottom + em }}>
          <Panel>
            <ActionRow
              icon="delete"
              title={m.source_delete()}
              tone="danger"
              onPress={() => askDelete(source)}
            />
          </Panel>
        </View>
      )}
    </>
  );
};

/** Add a source (no `id`) or edit one, as a page inside the Settings tab (admin). */
const PhoneSourceFormPage = ({ id }: { readonly id?: string | undefined }) => {
  const { colors } = useTheme();
  const queries = useApiQueries();
  const sources = useQuery({ ...queries.sources(), enabled: id !== undefined });
  const heading = id === undefined ? m.source_add() : m.source_edit();
  if (id !== undefined && sources.isError) {
    return (
      <PageStatus
        heading={heading}
        title={readProblem(sources.error)}
        onRetry={() => void sources.refetch()}
      />
    );
  }
  if (id !== undefined && sources.data === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <BackHeader title={heading} />
        <FormSkeleton fields={4} />
      </View>
    );
  }
  const source = id === undefined ? undefined : sources.data?.find((item) => item.id === id);
  if (id !== undefined && source === undefined) {
    return <PageStatus heading={heading} title={m.error_not_found()} />;
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <SourceFormBody source={source} />
    </KeyboardAvoidingView>
  );
};

/** PhoneSourceForm behind the admin gate. */
export const PhoneSourceForm = ({ id }: { readonly id?: string | undefined }) => (
  <AdminOnly heading={id === undefined ? m.source_add() : m.source_edit()}>
    <PhoneSourceFormPage id={id} />
  </AdminOnly>
);
