import { m } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import type { StatsRow } from "./stats.ts";

/**
 * The playback stats (Options › Playback stats), as the web shows them: quiet, monospaced
 * figures in a dark box, never in the way of a touch or of focus. It stays where it is whether
 * the controls show or not; Options turns it off, and so does Back on TV.
 */
export const StatsOverlay = ({
  rows,
  top,
  left,
}: {
  readonly rows: readonly StatsRow[];
  readonly top: number;
  readonly left: number;
}) => {
  const { colors, em, fonts, isTV, radii } = useTheme();
  const size = (isTV ? 0.8 : 0.7) * em;
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={m.player_stats()}
      style={{
        position: "absolute",
        top,
        left,
        width: (isTV ? 24 : 18) * em,
        paddingHorizontal: 0.9 * em,
        paddingVertical: 0.7 * em,
        gap: 0.25 * em,
        borderRadius: radii.rM,
        backgroundColor: colors.media,
      }}
    >
      {rows.map(([label, value]) => (
        <View key={label} style={{ flexDirection: "row", gap: em }}>
          <Text style={{ fontFamily: fonts.fUi, fontSize: size, color: colors.fg3 }}>{label}</Text>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              textAlign: "right",
              fontFamily: fonts.fMono,
              fontSize: size,
              color: colors.fg,
              fontVariant: ["tabular-nums"],
            }}
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
};
