import {
  draftFromRule,
  goesToOptions,
  newDraft,
  type SeriesTemplateId,
  seriesTemplateIds,
  seriesTemplateSeeds,
} from "@slipstream/domain";
import { m, seriesTemplateText } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApiQueries } from "../../data/hooks.ts";
import { channelNames } from "../../data/home.ts";
import { householdZone } from "../../data/zone.ts";
import { useTheme } from "../../theme/theme.ts";
import { OptionRow } from "../../ui/OptionRow.tsx";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { Bone, Skeleton } from "../../ui/Skeleton.tsx";
import { StatusScreen } from "../../ui/StatusScreen.tsx";
import { BackHeader } from "../BackHeader.tsx";
import { EditorForm } from "./EditorForm.tsx";
import { useEditorData } from "../../series/use-editor-data.ts";

/** The form while it loads: the sections' headings and panels in their usual sizes. */
const EditorSkeleton = () => {
  const { em, radii } = useTheme();
  const panels = [6.2, 7.5, 3, 6];
  return (
    <Skeleton>
      <View style={{ paddingHorizontal: em, paddingTop: 0.4 * em, gap: 1.3 * em }}>
        {panels.map((height, index) => (
          <View key={height} style={{ gap: 0.45 * em }}>
            <Bone width={index % 2 === 0 ? "40%" : "30%"} height={0.98 * em} />
            <Bone width="100%" height={height * em} radius={radii.rL} />
          </View>
        ))}
      </View>
    </Skeleton>
  );
};

/** "Start from a template": the web's four, and starting empty. */
const TemplateChooser = ({ onPick }: { readonly onPick: (id: SeriesTemplateId | "") => void }) => {
  const { colors, em, fonts, radii } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: em, paddingBottom: insets.bottom + 2 * em }}
    >
      <Text
        style={{
          fontFamily: fonts.fUi,
          fontSize: 0.95 * em,
          color: colors.fg2,
          paddingHorizontal: 0.25 * em,
          paddingBottom: 0.6 * em,
        }}
      >
        {m.series_phone_templates()}
      </Text>
      <View
        style={{
          borderRadius: radii.rL,
          backgroundColor: colors.surface,
          padding: 0.3 * em,
          gap: 0.2 * em,
        }}
      >
        {seriesTemplateIds.map((id) => {
          const text = seriesTemplateText(id);
          return (
            <OptionRow
              key={id}
              icon="series"
              title={text.title}
              hint={text.text}
              onPress={() => onPick(id)}
            />
          );
        })}
        <OptionRow
          icon="plus"
          title={m.series_phone_blank()}
          hint={m.series_phone_blank_text()}
          onPress={() => onPick("")}
        />
      </View>
    </ScrollView>
  );
};

/**
 * The series recording editor's screen on a phone, new (`id` undefined) or saved: a new one
 * offers the templates first; then the form (./EditorForm.tsx) once everything it reads is in,
 * a skeleton in its shape until then, and not found or a retry when it can't be read.
 */
export const PhoneSeriesEditor = ({ id }: { readonly id?: string | undefined }) => {
  const { colors } = useTheme();
  const queries = useApiQueries();
  const editor = useEditorData(id);
  const profiles = useQuery(queries.profiles());
  // undefined: not chosen yet; "" starts empty.
  const [template, setTemplate] = useState<SeriesTemplateId | "" | undefined>(undefined);
  const isNew = id === undefined;
  const title = isNew ? m.series_new() : m.series_title_edit();

  const body = () => {
    if (editor.error !== null) {
      return (
        <StatusScreen
          title={m.series_error_title()}
          actions={<FocusButton label={m.action_try_again()} onPress={editor.retry} />}
        />
      );
    }
    if (isNew && template === undefined) return <TemplateChooser onPick={setTemplate} />;
    if (editor.loading) return <EditorSkeleton />;
    const { rule, collections, access } = editor.data;
    if (!isNew && rule === undefined) return <StatusScreen title={m.series_not_found()} />;
    // A collection-limited profile starts on its own collection (SPEC §7.8).
    const start = goesToOptions(
      access,
      collections.map((collection) => collection.id),
      { mayCreateCollections: false },
    )?.initial;
    const initial =
      rule === undefined
        ? {
            ...newDraft(
              template === undefined || template === "" ? {} : seriesTemplateSeeds[template],
            ),
            ...(start?._tag === "Collection" ? { collectionId: start.collectionId } : {}),
          }
        : draftFromRule(rule);
    return (
      <EditorForm
        key={rule?.id ?? `new:${template ?? ""}`}
        initial={initial}
        data={editor.data}
        channelNames={channelNames(editor.allChannels)}
        ownerName={
          profiles.data?.find((profile) => profile.id === rule?.ownerId)?.displayName ?? ""
        }
        timeZone={householdZone()}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BackHeader title={title} />
      {body()}
    </View>
  );
};
