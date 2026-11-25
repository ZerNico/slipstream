import { stepPaddingMinutes } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../theme/theme.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { TextField, type TextFieldProps } from "../../ui/TextField.tsx";

/*
 * The phone's settings building blocks, one of each for every settings-like page (server
 * settings, sources, users, the series editor, a recording's page): a panel of rows, the hairline
 * between rows, a tappable row, a labelled field with its reserved message line, and a stepper.
 */

/** A rounded group of rows on the surface colour; `inset` keeps it off the screen's edges. */
export const Panel = ({
  inset = true,
  children,
}: {
  readonly inset?: boolean;
  readonly children: ReactNode;
}) => {
  const { colors, em, radii } = useTheme();
  return (
    <View
      style={{
        marginHorizontal: inset ? em : 0,
        borderRadius: radii.rL,
        backgroundColor: colors.surface,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
};

/** The hairline between two rows of a panel or list, indented like the rows' text. */
export const Hairline = () => {
  const { colors, em } = useTheme();
  return <View style={{ height: 1, marginLeft: em, backgroundColor: colors.line }} />;
};

/**
 * One tappable row of a panel: a glyph, a title, and at the end an optional value, a tick (the
 * chosen one) or a chevron (it opens a page).
 */
export const ActionRow = ({
  icon,
  title,
  value,
  trailing,
  tone = "default",
  disabled = false,
  onPress,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly value?: string | undefined;
  readonly trailing?: "check" | "chevron" | undefined;
  /** `danger` for removing something, `action` for the row's one call to act. */
  readonly tone?: "default" | "danger" | "action";
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const fg = tone === "danger" ? colors.liveText : tone === "action" ? colors.brandText : colors.fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected: trailing === "check" }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 0.9 * em,
        paddingHorizontal: em,
        paddingVertical: 0.85 * em,
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Icon name={icon} size={1.35 * em} color={fg} />
      <Text
        numberOfLines={2}
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: fg }}
      >
        {title}
      </Text>
      {value === undefined ? null : (
        <Text
          numberOfLines={1}
          style={{ maxWidth: "50%", fontFamily: fonts.fUi, fontSize: 0.92 * em, color: colors.fg2 }}
        >
          {value}
        </Text>
      )}
      {trailing === "check" ? <Icon name="check" size={1.3 * em} color={colors.brand} /> : null}
      {trailing === "chevron" ? (
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <Icon name="chevronLeft" size={1.2 * em} color={colors.fg3} />
        </View>
      ) : null}
    </Pressable>
  );
};

/**
 * A labelled field: the label over the control, then one line kept for the hint or the
 * problem, so a message appearing never moves what is below.
 */
export const Field = ({
  label,
  hint,
  problem,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly problem?: string | undefined;
  readonly children: ReactNode;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View style={{ gap: 0.4 * em }}>
      <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.9 * em, color: colors.fg2 }}>
        {label}
      </Text>
      {children}
      <Text
        accessibilityLiveRegion={problem === undefined ? "none" : "polite"}
        style={{
          minHeight: 1.25 * em,
          fontFamily: fonts.fUi,
          fontSize: 0.85 * em,
          color: problem === undefined ? colors.fg3 : colors.warnText,
        }}
      >
        {problem ?? hint ?? ""}
      </Text>
    </View>
  );
};

/** A {@link Field} holding a {@link TextField}: label above, the hint or the error below. */
export const FormField = ({
  label,
  hint,
  error,
  placeholder,
  ...props
}: TextFieldProps & {
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}) => (
  <Field label={label} hint={hint} problem={error}>
    <TextField
      {...props}
      label={label}
      placeholder={placeholder ?? ""}
      invalid={error !== undefined}
    />
  </Field>
);

/** One arrow of the stepper, a touch target of its own. */
const StepArrow = ({
  icon,
  label,
  disabled,
  onPress,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
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
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Icon name={icon} size={1.1 * em} color={colors.fg2} />
    </Pressable>
  );
};

/**
 * A value stepped with arrows: "‹ 10 min ›". Screen readers get it as one adjustable value named
 * `label`; an arrow that cannot step further is dimmed.
 */
export const Stepper = ({
  label,
  value,
  canLess = true,
  canMore = true,
  disabled = false,
  onStep,
}: {
  readonly label: string;
  /** The value as written ("5 min", "3"). */
  readonly value: string;
  readonly canLess?: boolean;
  readonly canMore?: boolean;
  readonly disabled?: boolean;
  readonly onStep: (direction: 1 | -1) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const step = (direction: 1 | -1) => {
    if (disabled || !(direction === 1 ? canMore : canLess)) return;
    void Haptics.selectionAsync();
    onStep(direction);
  };
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
      style={{ flexDirection: "row", alignItems: "center", gap: 0.2 * em }}
    >
      <StepArrow
        icon="back"
        label={m.field_less({ label })}
        disabled={disabled || !canLess}
        onPress={() => step(-1)}
      />
      <Text
        accessibilityLiveRegion="polite"
        style={{
          fontFamily: fonts.fMonoSemiBold,
          fontSize: 0.95 * em,
          color: disabled ? colors.fg3 : colors.fg,
          minWidth: 4.6 * em,
          textAlign: "center",
        }}
      >
        {value}
      </Text>
      <StepArrow
        icon="fwd"
        label={m.field_more({ label })}
        disabled={disabled || !canMore}
        onPress={() => step(1)}
      />
    </View>
  );
};

/**
 * Extra minutes as a {@link Stepper}, walking the steps every client offers (fine near zero,
 * coarse towards four hours).
 */
export const MinutesStepper = ({
  label,
  minutes,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly minutes: number;
  readonly disabled?: boolean;
  readonly onChange: (minutes: number) => void;
}) => {
  const lower = stepPaddingMinutes(minutes, -1);
  const higher = stepPaddingMinutes(minutes, 1);
  return (
    <Stepper
      label={label}
      value={m.rec_minutes({ minutes })}
      canLess={lower !== minutes}
      canMore={higher !== minutes}
      disabled={disabled}
      onStep={(direction) => onChange(direction === 1 ? higher : lower)}
    />
  );
};

/** A row of a panel with a title and a {@link Stepper} at its end. */
export const StepperRow = ({
  title,
  ...stepper
}: { readonly title: string } & Omit<Parameters<typeof Stepper>[0], "label">) => {
  const { colors, em, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.4 * em,
        minHeight: 3.2 * em,
        paddingLeft: em,
        paddingRight: 0.4 * em,
      }}
    >
      <Text
        numberOfLines={2}
        style={{ flex: 1, fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}
      >
        {title}
      </Text>
      <Stepper label={title} {...stepper} />
    </View>
  );
};
