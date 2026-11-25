import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../theme/theme.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";

/*
 * The building blocks of the phone's series editor: a grouped section, a row that opens a
 * picker, a text box, a stepper and the line a problem is said on.
 */

/** One group of the form: a heading over a rounded panel. */
export const Section = ({
  title,
  children,
  aside,
}: {
  readonly title: string;
  readonly children: ReactNode;
  /** Something small at the end of the heading ("6 will record"). */
  readonly aside?: ReactNode;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  return (
    <View style={{ gap: 0.45 * em }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          gap: 0.6 * em,
          paddingHorizontal: 0.25 * em,
        }}
      >
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}
        >
          {title}
        </Text>
        {aside}
      </View>
      <View style={{ borderRadius: radii.rL, backgroundColor: colors.surface, overflow: "hidden" }}>
        {children}
      </View>
    </View>
  );
};

/** A row of a panel: its label and what it is set to; a tap opens its picker. */
export const PickRow = ({
  label,
  value,
  onPress,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.8 * em,
        minHeight: 3 * em,
        paddingHorizontal: em,
        paddingVertical: 0.7 * em,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      <Text
        numberOfLines={2}
        style={{ flexShrink: 1, fontFamily: fonts.fUi, fontSize: 0.95 * em, color: colors.fg2 }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={2}
        style={{
          flex: 1,
          minWidth: "40%",
          textAlign: "right",
          fontFamily: fonts.fUiSemiBold,
          fontSize: 0.95 * em,
          color: disabled ? colors.fg3 : colors.fg,
        }}
      >
        {value}
      </Text>
    </Pressable>
  );
};

/**
 * The line a problem is said on, under its field. It always takes its height, so a problem
 * appearing never moves what follows.
 */
export const ProblemLine = ({ text }: { readonly text: string | undefined }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 0.4 * em, minHeight: 1.4 * em }}
    >
      {text === undefined ? null : (
        <>
          <Icon name="warn" size={0.95 * em} color={colors.liveText} />
          <Text
            accessibilityLiveRegion="polite"
            style={{ flex: 1, fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.liveText }}
          >
            {text}
          </Text>
        </>
      )}
    </View>
  );
};

/** A round icon button: remove a condition, step a value. */
export const IconPress = ({
  icon,
  label,
  onPress,
  disabled = false,
  color,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly color?: string;
}) => {
  const { colors, em } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={0.4 * em}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 2.4 * em,
        height: 2.4 * em,
        borderRadius: 1.2 * em,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={icon} size={1.2 * em} color={color ?? colors.fg2} />
    </Pressable>
  );
};

/** A quiet text button in a panel ("Add condition", "Reset"). */
export const LinkButton = ({
  label,
  icon,
  onPress,
}: {
  readonly label: string;
  readonly icon?: IconName;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.5 * em,
        minHeight: 3 * em,
        paddingHorizontal: em,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      {icon === undefined ? null : <Icon name={icon} size={1.1 * em} color={colors.brandText} />}
      <Text
        numberOfLines={2}
        style={{
          flexShrink: 1,
          fontFamily: fonts.fUiSemiBold,
          fontSize: 0.95 * em,
          color: colors.brandText,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};
