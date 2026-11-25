import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";

/** One choice of a {@link Segmented}. */
export interface Segment<A extends string> {
  readonly value: A;
  readonly label: string;
}

/**
 * A few short choices side by side (the web's `.seg`): the chosen one sits raised in the track.
 * On TV each is focusable and the focused one fills amber, as every focus does.
 */
export const Segmented = <A extends string>({
  label,
  segments,
  selected,
  preferredFocus = false,
  onPick,
}: {
  /** What the choice is about, for a screen reader. */
  readonly label: string;
  readonly segments: readonly Segment<A>[];
  readonly selected: A;
  /** The chosen segment takes focus first when the sheet opens (TV). */
  readonly preferredFocus?: boolean;
  readonly onPick: (value: A) => void;
}) => {
  const { colors, em } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        gap: 0.2 * em,
        padding: 0.2 * em,
        marginHorizontal: em,
        borderRadius: 2 * em,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      {segments.map((segment) => (
        <SegmentButton
          key={segment.value}
          label={segment.label}
          chosen={segment.value === selected}
          preferredFocus={preferredFocus && segment.value === selected}
          onPress={() => onPick(segment.value)}
        />
      ))}
    </View>
  );
};

const SegmentButton = ({
  label,
  chosen,
  preferredFocus,
  onPress,
}: {
  readonly label: string;
  readonly chosen: boolean;
  readonly preferredFocus: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = isTV && focused;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: chosen }}
      style={{
        flex: 1,
        alignItems: "center",
        paddingVertical: 0.65 * em,
        borderRadius: 2 * em,
        borderWidth: 1,
        borderColor: chosen && !lit ? colors.line : "transparent",
        backgroundColor: lit ? colors.brand : chosen ? colors.raised : "transparent",
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.05 * em,
          color: lit ? colors.onBrand : chosen ? colors.fg : colors.fg2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};
