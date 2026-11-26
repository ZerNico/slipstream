import {
  type FitMode,
  playbackSpeeds,
  type QualityChoice,
  qualityChoices,
} from "@slipstream/domain";
import { deviceQualityLabel, m } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { OptionRow } from "../ui/OptionRow.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import type { PlayerPrefs } from "./player-prefs.ts";

/** A quality as the menu names it: Household default, Original, or the cap ("4 Mbit/s"). */
const qualityLabel = (choice: QualityChoice): string =>
  choice === "auto"
    ? deviceQualityLabel(choice)
    : choice === "original"
      ? m.quality_original()
      : m.player_quality_cap({ kbps: Number(choice) });

/** A small heading over a group of rows. */
const Heading = ({ children }: { readonly children: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      style={{
        fontFamily: fonts.fUiSemiBold,
        fontSize: 0.9 * em,
        color: colors.fg3,
        marginTop: 0.8 * em,
        paddingHorizontal: em,
      }}
    >
      {children}
    </Text>
  );
};

/**
 * The player's Options (the web's Options menu): Fit or Fill first, as a pair, then the quality,
 * the playback speed and the playback stats, ticked where they stand. A pick applies at once and
 * the sheet stays open, so trying another is one more press.
 */
export const OptionsSheet = ({
  prefs,
  speed,
  onQuality,
  onSpeed,
  onFit,
  onStats,
  onClose,
}: {
  readonly prefs: PlayerPrefs;
  readonly speed: number;
  readonly onQuality: (quality: QualityChoice) => void;
  readonly onSpeed: (speed: number) => void;
  readonly onFit: (fit: FitMode) => void;
  readonly onStats: (on: boolean) => void;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const fits: readonly { readonly value: FitMode; readonly label: string }[] = [
    { value: "fit", label: m.player_fit_short() },
    { value: "fill", label: m.player_fill_short() },
  ];
  const stats: readonly { readonly value: "off" | "on"; readonly label: string }[] = [
    { value: "off", label: m.player_stats_off() },
    { value: "on", label: m.player_stats_on() },
  ];
  return (
    <Sheet label={m.action_options()} onClose={onClose}>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.6 * em, color: colors.fg }}>
        {m.action_options()}
      </Text>
      <View style={{ gap: 0.2 * em }}>
        <Heading>{m.player_picture_heading()}</Heading>
        <Segmented
          label={m.player_picture_heading()}
          segments={fits}
          selected={prefs.fit}
          preferredFocus
          onPick={onFit}
        />
        <Heading>{m.player_quality()}</Heading>
        {qualityChoices.map((choice) => (
          <OptionRow
            key={choice}
            title={qualityLabel(choice)}
            hint={choice === "auto" ? m.quality_server_default_detail() : undefined}
            selected={choice === prefs.quality}
            onPress={() => onQuality(choice)}
          />
        ))}
        <Heading>{m.player_speed()}</Heading>
        {playbackSpeeds.map((candidate) => (
          <OptionRow
            key={candidate}
            title={
              candidate === 1
                ? m.player_speed_normal({ speed: candidate })
                : m.player_speed_value({ speed: candidate })
            }
            selected={candidate === speed}
            onPress={() => onSpeed(candidate)}
          />
        ))}
        <Heading>{m.player_stats()}</Heading>
        <Segmented
          label={m.player_stats()}
          segments={stats}
          selected={prefs.stats ? "on" : "off"}
          onPick={(value) => onStats(value === "on")}
        />
      </View>
    </Sheet>
  );
};
