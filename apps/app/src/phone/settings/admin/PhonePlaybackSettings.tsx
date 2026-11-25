import type { PlaybackSettings } from "@slipstream/api";
import { pictureConversionChoices, qualityChoices } from "@slipstream/domain";
import { m, pictureConversionsLabel, qualityLabel } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Switch } from "react-native";
import { readProblem } from "../../../api/failure.ts";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { PickerSheet } from "../../../ui/PickerSheet.tsx";
import { queryKeys } from "../../../api/keys.ts";
import { useApiQueries } from "../../../data/hooks.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { Icon } from "../../../ui/Icon.tsx";
import { adminSettingsActions } from "./api.ts";
import { Group, PickerValue, Row, SettingsPage, SettingsSkeleton } from "./parts.tsx";
import { playbackShape } from "./shapes.ts";
import { useAutosave } from "./use-autosave.ts";

/** The three situations that each have a default quality. */
type Situation = keyof PlaybackSettings["quality"];

/** A situation's name ("At home"). */
const situationTitle = (situation: Situation): string =>
  situation === "home"
    ? m.settings_at_home()
    : situation === "away"
      ? m.settings_away()
      : m.settings_mobile();

/** The page once its settings are in; every change saves itself. */
const PlaybackBody = ({
  value,
  onChange,
}: {
  readonly value: PlaybackSettings;
  readonly onChange: (next: PlaybackSettings) => void;
}) => {
  const { colors } = useTheme();
  const [picking, setPicking] = useState<Situation | undefined>(undefined);
  const [pickingConversions, setPickingConversions] = useState(false);
  const detected = value.detected;
  const automatic = value.hardwareAcceleration === "auto";
  const situations: readonly Situation[] = ["home", "away", "mobile"];
  return (
    <>
      <Group>
        <Row
          title={m.settings_hardware()}
          sub={
            !automatic
              ? m.playback_software()
              : detected === undefined || !detected.ok
                ? m.settings_hardware_auto()
                : m.playback_auto_with({ name: detected.name })
          }
          end={
            <Switch
              accessibilityLabel={m.settings_hardware()}
              value={automatic}
              onValueChange={(on) => {
                void Haptics.selectionAsync();
                onChange({ ...value, hardwareAcceleration: on ? "auto" : "off" });
              }}
              trackColor={{ true: colors.brand, false: colors.raised }}
              thumbColor={colors.fg}
            />
          }
        />
        <Row
          title={m.settings_picture_conversions()}
          label={`${m.settings_picture_conversions()}, ${pictureConversionsLabel(value.pictureConversions)}`}
          end={<PickerValue text={pictureConversionsLabel(value.pictureConversions)} />}
          onPress={() => setPickingConversions(true)}
        />
      </Group>
      <Group title={m.settings_quality_title()}>
        {situations.map((situation) => (
          <Row
            key={situation}
            title={situationTitle(situation)}
            label={`${situationTitle(situation)}, ${qualityLabel(value.quality[situation])}`}
            end={<PickerValue text={qualityLabel(value.quality[situation])} />}
            onPress={() => setPicking(situation)}
          />
        ))}
      </Group>
      {picking === undefined ? null : (
        <PickerSheet
          title={situationTitle(picking)}
          choices={qualityChoices.map((quality) => ({
            value: quality,
            label: qualityLabel(quality),
          }))}
          selected={value.quality[picking]}
          onPick={(quality) =>
            onChange({ ...value, quality: { ...value.quality, [picking]: quality } })
          }
          onClose={() => setPicking(undefined)}
        />
      )}
      {pickingConversions ? (
        <PickerSheet
          title={m.settings_picture_conversions()}
          choices={pictureConversionChoices.map((limit) => ({
            value: limit,
            label: pictureConversionsLabel(limit),
          }))}
          selected={value.pictureConversions}
          onPick={(pictureConversions) => onChange({ ...value, pictureConversions })}
          onClose={() => setPickingConversions(false)}
        />
      ) : null}
    </>
  );
};

/**
 * Each device can choose its own quality: a row back to Settings, where This device has it. It
 * needs no data, so it stays put below the skeleton and the loaded groups alike.
 */
const DeviceQualityGroup = () => {
  const router = useRouter();
  const { colors, em } = useTheme();
  return (
    <Group footer={m.settings_device_quality_note()}>
      <Row
        title={m.settings_device_quality_link()}
        end={<Icon name="fwd" size={0.9 * em} color={colors.fg3} />}
        onPress={() => router.dismissTo("/settings")}
      />
    </Group>
  );
};

/**
 * Settings › Default quality on a phone, the household's: hardware acceleration as a switch
 * (with what the server found), how many pictures the server converts at once, and the default
 * quality at home, away and on mobile data, each picked in a sheet, for every device left on
 * "Household default". Changes save themselves.
 */
const PlaybackPage = () => {
  const title = m.settings_section_default_quality();
  const queries = useApiQueries();
  const { runAction } = useSession();
  const settings = useQuery(queries.playbackSettings());
  const draft = useAutosave(settings.data, queryKeys.playbackSettings, (value) =>
    runAction(adminSettingsActions.savePlayback(value)),
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
  return (
    <SettingsPage title={title}>
      {draft.value === undefined ? (
        <SettingsSkeleton groups={playbackShape} />
      ) : (
        <PlaybackBody value={draft.value} onChange={draft.change} />
      )}
      <DeviceQualityGroup />
    </SettingsPage>
  );
};

/** Settings › Default quality, for admins. */
export const PhonePlaybackSettings = () => (
  <AdminOnly heading={m.settings_section_default_quality()}>
    <PlaybackPage />
  </AdminOnly>
);
