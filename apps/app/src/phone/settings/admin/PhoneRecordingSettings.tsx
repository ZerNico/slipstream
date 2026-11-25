import type { RecordingSettings } from "@slipstream/api";
import {
  type Channel,
  type ExtraTimeDefaults,
  type ExtraTimeOverride,
  type Padding,
  removeOverride,
  setGlobalPadding,
  setOverridePadding,
} from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Alert, Pressable } from "react-native";
import { readProblem } from "../../../api/failure.ts";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { MinutesStepper } from "../../ui/settings.tsx";
import { queryKeys } from "../../../api/keys.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { AddExceptionSheet } from "./AddExceptionSheet.tsx";
import { adminSettingsActions } from "./api.ts";
import { Group, Row, SettingsPage, SettingsSkeleton } from "./parts.tsx";
import { PicturesGroup } from "./PicturesGroup.tsx";
import { recordingShape } from "./shapes.ts";
import { useAutosave } from "./use-autosave.ts";

/** An exception's name: its channel's, or the guide category it names. */
const overrideName = (override: ExtraTimeOverride, channels: readonly Channel[]): string =>
  override._tag === "Channel"
    ? (channels.find((channel) => channel.id === override.channelId)?.name ?? override.channelId)
    : override.category;

/** The bin at the end of an exception's row. */
const RemoveButton = ({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) => {
  const { colors, em, radii } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={0.4 * em}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 2.4 * em,
        height: 2.4 * em,
        borderRadius: radii.rM,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      <Icon name="delete" size={1.2 * em} color={colors.liveText} />
    </Pressable>
  );
};

/**
 * Start early and End late of one padding, as two stepper rows (separate children, so the group
 * draws its hairline between them). `name` says whose minutes they are to screen readers
 * ("Start early, Sport"); none for the default.
 */
const paddingRows = (
  padding: Padding,
  onChange: (padding: Padding) => void,
  name?: string,
): ReactNode[] => [
  <Row
    key="early"
    title={m.padding_before()}
    end={
      <MinutesStepper
        label={name === undefined ? m.padding_before() : `${m.padding_before()}, ${name}`}
        minutes={padding.beforeMinutes}
        onChange={(beforeMinutes) => onChange({ ...padding, beforeMinutes })}
      />
    }
  />,
  <Row
    key="late"
    title={m.padding_after()}
    end={
      <MinutesStepper
        label={name === undefined ? m.padding_after() : `${m.padding_after()}, ${name}`}
        minutes={padding.afterMinutes}
        onChange={(afterMinutes) => onChange({ ...padding, afterMinutes })}
      />
    }
  />,
];

/** The page once its settings are in; every change saves itself. */
const RecordingBody = ({
  value,
  channels,
  tmdb,
  onChange,
}: {
  readonly value: RecordingSettings;
  readonly channels: readonly Channel[];
  /** Whether TMDB is connected; undefined when that could not be read. */
  readonly tmdb: boolean | undefined;
  readonly onChange: (next: RecordingSettings) => void;
}) => {
  const [adding, setAdding] = useState(false);
  const defaults = value.extraTime;
  const setDefaults = (extraTime: ExtraTimeDefaults) => onChange({ ...value, extraTime });
  const count = defaults.overrides.length;
  const askRemove = (index: number, name: string) =>
    Alert.alert(m.settings_override_remove_question({ name }), m.settings_override_remove_text(), [
      { text: m.action_cancel(), style: "cancel" },
      {
        text: m.settings_remove(),
        style: "destructive",
        onPress: () => setDefaults(removeOverride(defaults, index)),
      },
    ]);

  return (
    <>
      <Group title={m.series_section_extra()}>
        {paddingRows(defaults.padding, (padding) =>
          setDefaults(setGlobalPadding(defaults, padding)),
        )}
      </Group>
      {defaults.overrides.map((override, index) => {
        const name = overrideName(override, channels);
        return (
          <Group
            key={override._tag === "Channel" ? override.channelId : `c:${override.category}`}
            title={index === 0 ? m.rec_overrides_title() : undefined}
          >
            <Row
              title={name}
              sub={override._tag === "Channel" ? m.rec_kind_channel() : m.rec_kind_category()}
              end={
                <RemoveButton
                  label={m.rec_override_remove({ name })}
                  onPress={() => askRemove(index, name)}
                />
              }
            />
            {paddingRows(
              override.padding,
              (padding) => setDefaults(setOverridePadding(defaults, index, padding)),
              name,
            )}
          </Group>
        );
      })}
      <Group title={count === 0 ? m.rec_overrides_title() : undefined}>
        <Row
          icon="plus"
          tone="action"
          title={m.rec_override_add()}
          onPress={() => setAdding(true)}
        />
      </Group>
      {tmdb === undefined ? null : <PicturesGroup connected={tmdb} />}
      {adding ? (
        <AddExceptionSheet
          defaults={defaults}
          channels={channels}
          onAdd={setDefaults}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
};

/**
 * Settings › Recording on a phone: how early to start and how late to end, exceptions per
 * channel or guide category (each with its own steppers, removed after a confirm), and the
 * pictures from TMDB. Changes save themselves and never rewrite existing series recordings.
 */
const RecordingPage = () => {
  const title = m.settings_section_recording();
  const queries = useApiQueries();
  const app = useApiQueries();
  const { runAction } = useSession();
  const settings = useQuery(queries.recordingSettings());
  const artwork = useQuery(queries.artworkSettings());
  const channels = useQuery(app.channels());
  const draft = useAutosave(settings.data, queryKeys.recordingSettings, (value) =>
    runAction(adminSettingsActions.saveRecording(value)),
  );

  if (settings.isError) {
    return (
      <PageStatus
        heading={title}
        title={readProblem(settings.error)}
        onRetry={() => void settings.refetch()}
      />
    );
  }
  const value = draft.value;
  return (
    <SettingsPage title={title}>
      {value === undefined || channels.isPending || artwork.isPending ? (
        <SettingsSkeleton groups={recordingShape} />
      ) : (
        <RecordingBody
          value={value}
          channels={channels.data ?? []}
          tmdb={artwork.data?.tmdb}
          onChange={draft.change}
        />
      )}
    </SettingsPage>
  );
};

/** Settings › Recording, for admins. */
export const PhoneRecordingSettings = () => (
  <AdminOnly heading={m.settings_section_recording()}>
    <RecordingPage />
  </AdminOnly>
);
