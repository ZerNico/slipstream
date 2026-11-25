import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { type Ref, useState } from "react";
import { TextInput, type TextInputInstance, type TextInputProps } from "react-native";
import { useTheme } from "../theme/theme.ts";

/** Props for {@link TextField}: a label for screen readers plus the usual input props. */
export interface TextFieldProps extends Pick<
  TextInputProps,
  | "value"
  | "onChangeText"
  | "onSubmitEditing"
  | "onBlur"
  | "secureTextEntry"
  | "autoComplete"
  | "autoCapitalize"
  | "keyboardType"
  | "returnKeyType"
  | "submitBehavior"
  | "autoFocus"
  | "editable"
  | "selectTextOnFocus"
> {
  /** What a screen reader calls it. */
  readonly label: string;
  /** The quiet text while empty; the label when not given, "" for none. */
  readonly placeholder?: string | undefined;
  /** Something is wrong with it: the border says so. */
  readonly invalid?: boolean;
  readonly inputRef?: Ref<TextInputInstance>;
  /** Inside a phone bottom sheet: the sheet's own input, so the keyboard lifts the sheet. */
  readonly inSheet?: boolean;
}

/**
 * The app's one text input, styled with the input tokens: the border brightens while it is
 * active and turns to the problem colour while `invalid`.
 */
export const TextField = ({
  label,
  placeholder,
  invalid = false,
  inputRef,
  inSheet = false,
  autoCapitalize = "none",
  ...props
}: TextFieldProps) => {
  const { colors, tokens, em, fonts, isTV } = useTheme();
  const input = tokens.components.input;
  const [active, setActive] = useState(false);
  const fontSize = (isTV ? 1.3 : 1) * em;
  const shared = {
    ...props,
    accessibilityLabel: label,
    placeholder: placeholder ?? label,
    placeholderTextColor: colors.fg3,
    autoCapitalize,
    autoCorrect: false,
    onFocus: () => setActive(true),
    onBlur: (event: Parameters<NonNullable<TextInputProps["onBlur"]>>[0]) => {
      setActive(false);
      props.onBlur?.(event);
    },
    style: {
      fontFamily: fonts.fUi,
      fontSize,
      color: colors.fg,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: invalid ? colors.liveText : active ? input.activeBorder : input.border,
      borderRadius: 0.6 * fontSize,
      paddingHorizontal: 0.8 * fontSize,
      paddingVertical: 0.6 * fontSize,
      minWidth: isTV ? 30 * em : undefined,
    },
  };
  return inSheet ? <BottomSheetTextInput {...shared} /> : <TextInput {...shared} ref={inputRef} />;
};
