import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { Icon, type IconName } from "./Icon.tsx";

/**
 * One option row of a side sheet (`.opt`): amber fill on focus, an optional glyph, a title, a
 * hint and an optional value; `selected` ticks it at the end, as in a menu. The record sheet,
 * the watch choice, the player's options and the recording sheet share it. Phones have no focus
 * to show (a touch would leave the first row lit), so there the fill follows the finger instead.
 */
export const OptionRow = ({
  icon,
  title,
  hint,
  selected = false,
  preferredFocus = false,
  onPress,
  onFocus,
  children,
}: {
  readonly icon?: IconName | undefined;
  readonly title: string;
  readonly hint?: string | undefined;
  readonly selected?: boolean;
  readonly preferredFocus?: boolean;
  readonly onPress?: (() => void) | undefined;
  readonly onFocus?: (() => void) | undefined;
  readonly children?: ReactNode;
}) => {
  const { colors, em, fonts, isTV, radii } = useTheme();
  const [focusedState, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const focused = isTV ? focusedState : pressed;
  const fg = focused ? colors.onBrand : colors.fg;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: em,
        paddingVertical: 0.8 * em,
        paddingHorizontal: em,
        borderRadius: radii.rM,
        backgroundColor: focused ? colors.brand : "transparent",
      }}
    >
      {icon === undefined ? null : <Icon name={icon} size={1.5 * em} color={fg} />}
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.15 * em, color: fg }}
        >
          {title}
        </Text>
        {hint === undefined || hint === "" ? null : (
          <Text
            numberOfLines={3}
            style={{
              fontFamily: fonts.fUi,
              fontSize: em,
              color: focused ? colors.onBrand : colors.fg3,
            }}
          >
            {hint}
          </Text>
        )}
      </View>
      {children}
      {selected ? <Icon name="check" size={1.4 * em} color={fg} /> : null}
    </Pressable>
  );
};
