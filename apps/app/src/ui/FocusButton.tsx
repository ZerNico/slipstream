import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../theme/theme.ts";
import { Icon, type IconName } from "./Icon.tsx";

/** Looks of a button: the primary action, a quiet one, or the default raised one. */
export type ButtonVariant = "primary" | "default" | "ghost";

/** Props for {@link FocusButton}. */
export interface FocusButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  /** A long press (phone) or a held OK (TV): the secondary action, such as more options. */
  readonly onLongPress?: (() => void) | undefined;
  readonly variant?: ButtonVariant;
  /** `live`: the label and glyph in the recording red while not focused (Recording). */
  readonly tone?: "live" | undefined;
  /** A glyph before the label. */
  readonly icon?: IconName | undefined;
  /** Takes focus first when the screen opens (TV). */
  readonly preferredFocus?: boolean;
  /** Font size in em of the current device. */
  readonly size?: number;
  readonly onFocus?: () => void;
  readonly disabled?: boolean;
  /** Only the glyph, round; the label is still what a screen reader says. */
  readonly iconOnly?: boolean;
  /** One of a choice (a filter): a screen reader says whether it is the chosen one. */
  readonly selected?: boolean | undefined;
}

/**
 * A button for both form factors. On TV the focused button is the only amber thing on screen:
 * it fills with the brand colour and scales up slightly (`.is-focus`). On phone the primary
 * variant is amber and focus never applies.
 */
export const FocusButton = ({
  label,
  onPress,
  onLongPress,
  variant = "default",
  tone,
  icon,
  preferredFocus = false,
  size = 1,
  onFocus,
  disabled = false,
  iconOnly = false,
  selected,
}: FocusButtonProps) => {
  const { colors, tokens, em, fonts, motion } = useTheme();
  const button = tokens.components.button;
  const [focused, setFocused] = useState(false);
  const progress = useDerivedValue(() =>
    withTiming(focused ? 1 : 0, {
      duration: motion.tFocus,
      easing: Easing.bezier(...motion.easing),
    }),
  );
  const rest =
    variant === "primary"
      ? button.primary.bg
      : variant === "ghost"
        ? "transparent"
        : button.secondary.bg;
  const restText =
    variant === "primary"
      ? button.primary.fg
      : variant === "ghost"
        ? button.ghost.fg
        : button.secondary.fg;
  const scale = motion.focusScale;
  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [rest, colors.brand]),
    transform: [{ scale: 1 + progress.value * (scale - 1) }],
  }));
  const fontSize = size * em;
  const textColor = focused ? colors.onBrand : tone === "live" ? colors.liveText : restText;
  return (
    <Pressable
      onPress={onPress}
      {...(onLongPress === undefined ? {} : { onLongPress })}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={preferredFocus}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? { disabled } : { disabled, selected }}
      // A compact button still takes a thumb-sized touch.
      hitSlop={0.25 * em}
    >
      <Animated.View
        style={[
          styles.button,
          {
            paddingVertical: 0.8 * fontSize,
            paddingHorizontal: iconOnly ? 0.8 * fontSize : 1.15 * fontSize,
            borderRadius: iconOnly ? 2 * fontSize : 0.65 * fontSize,
            borderColor: focused || variant !== "default" ? "transparent" : button.secondary.border,
            opacity: disabled ? 0.5 : 1,
          },
          animated,
        ]}
      >
        <View style={[styles.row, { gap: 0.5 * fontSize }]}>
          {icon === undefined ? null : <Icon name={icon} size={1.2 * fontSize} color={textColor} />}
          {iconOnly && icon !== undefined ? null : (
            // A long label (German) wraps inside the button rather than running out of it.
            <Text
              style={{ flexShrink: 1, fontFamily: fonts.fUiSemiBold, fontSize, color: textColor }}
            >
              {label}
            </Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: { borderWidth: 1, alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center" },
});
