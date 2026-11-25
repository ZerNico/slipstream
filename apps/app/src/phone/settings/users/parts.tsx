import { avatarTones } from "@slipstream/design-tokens/native";
import { avatarInitials, type AvatarTone } from "@slipstream/domain";
import type { ReactNode } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useTheme } from "../../../theme/theme.ts";
import { Icon, type IconName } from "../../../ui/Icon.tsx";

/*
 * The pieces the Users and Your profile pages share on a phone: avatars, grouped panels with
 * their headings, labelled fields with a reserved message line, switch and stepper rows.
 */

/** A person's avatar: initials on their profile's tone, the same in every theme. */
export const Avatar = ({
  name,
  tone,
  size,
}: {
  readonly name: string;
  readonly tone: AvatarTone;
  readonly size: number;
}) => {
  const { fonts } = useTheme();
  const colours = avatarTones[tone];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colours.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.4 * size, color: colours.ink }}>
        {avatarInitials(name)}
      </Text>
    </View>
  );
};

/** A heading over a panel, with an optional action at its right. */
export const PanelHeading = ({
  title,
  action,
}: {
  readonly title: string;
  readonly action?: ReactNode;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 2.6 * em,
        paddingHorizontal: em,
        paddingTop: 1.1 * em,
        paddingBottom: 0.3 * em,
        gap: em,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 1.05 * em, color: colors.fg }}
      >
        {title}
      </Text>
      {action}
    </View>
  );
};

/**
 * One tappable row of a panel: something at the start (an avatar or a glyph), a title that
 * wraps, a line under it, and what sits at the end. The row darkens under the finger.
 */
export const PanelRow = ({
  lead,
  title,
  sub,
  extra,
  end,
  tone = "default",
  label,
  selected,
  onPress,
}: {
  readonly lead?: ReactNode;
  readonly title: string;
  readonly sub?: string | undefined;
  /** A second, quieter line under `sub`. */
  readonly extra?: string | undefined;
  readonly end?: ReactNode;
  /** `danger` writes the row in the live colour (Delete). */
  readonly tone?: "default" | "danger";
  /** What a screen reader says, when it is more than the title. */
  readonly label?: string;
  /** One of a choice: ticked at the end when chosen. */
  readonly selected?: boolean;
  readonly onPress?: (() => void) | undefined;
}) => {
  const { colors, em, fonts } = useTheme();
  const ink = tone === "danger" ? colors.liveText : colors.fg;
  return (
    <Pressable
      accessibilityRole={
        onPress === undefined ? undefined : selected === undefined ? "button" : "radio"
      }
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={
        label ?? [title, sub, extra].filter((part) => part !== undefined).join(", ")
      }
      disabled={onPress === undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.9 * em,
        paddingHorizontal: em,
        paddingVertical: 0.8 * em,
        minHeight: 3.2 * em,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      {lead}
      <View style={{ flex: 1, gap: 0.15 * em }}>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: ink }}
        >
          {title}
        </Text>
        {sub === undefined ? null : (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg2 }}>
            {sub}
          </Text>
        )}
        {extra === undefined ? null : (
          <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg3 }}>
            {extra}
          </Text>
        )}
      </View>
      {end}
      {selected === true ? <Icon name="check" size={1.3 * em} color={colors.brandText} /> : null}
    </Pressable>
  );
};

/** A glyph at the start of a row, sized like an avatar's room. */
export const RowGlyph = ({
  name,
  tone = "default",
}: {
  readonly name: IconName;
  readonly tone?: "default" | "danger";
}) => {
  const { colors, em } = useTheme();
  return (
    <Icon name={name} size={1.35 * em} color={tone === "danger" ? colors.liveText : colors.fg} />
  );
};

/** A row with a title and a switch at its end. */
export const SwitchRow = ({
  title,
  value,
  onChange,
  disabled = false,
}: {
  readonly title: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly disabled?: boolean;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: em,
        paddingVertical: 0.6 * em,
        minHeight: 3.2 * em,
      }}
    >
      <Text
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}
      >
        {title}
      </Text>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.brand, false: colors.raised }}
        thumbColor={colors.fg}
      />
    </View>
  );
};
