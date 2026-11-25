import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";

/** Chip looks from the design doc (`.chip.live`, `.chip.rec`, `.chip.warn`, `.chip.outline`). */
export type ChipTone = "live" | "rec" | "warn" | "outline";

/** A small status label. `size` is the font size in em. */
export const Chip = ({
  label,
  tone,
  size = 0.8,
}: {
  readonly label: string;
  readonly tone: ChipTone;
  readonly size?: number;
}) => {
  const { tokens, em, fonts } = useTheme();
  const chip = tokens.components.chip;
  const fontSize = size * em;
  const colours =
    tone === "live"
      ? chip.live
      : tone === "rec"
        ? chip.recording
        : tone === "warn"
          ? chip.warn
          : { bg: "transparent", fg: chip.outline.fg };
  return (
    <View
      style={{
        backgroundColor: colours.bg,
        borderRadius: 0.45 * fontSize,
        paddingHorizontal: 0.6 * fontSize,
        paddingVertical: 0.42 * fontSize,
        borderWidth: tone === "outline" ? 1 : 0,
        borderColor: chip.outline.border,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize,
          color: colours.fg,
          letterSpacing: tone === "live" ? 0.08 * fontSize : 0.02 * fontSize,
        }}
      >
        {label}
      </Text>
    </View>
  );
};
