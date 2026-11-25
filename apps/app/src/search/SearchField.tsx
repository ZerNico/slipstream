import { m } from "@slipstream/i18n";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { Icon } from "../ui/Icon.tsx";

/**
 * The search field of both pages: a glyph and the input on the input tokens, the border
 * brightening while it is active. On Android TV focusing it and pressing OK opens the system
 * keyboard, with its voice input.
 */
export const SearchField = ({
  value,
  onChangeText,
  onSubmit,
  autoFocus = false,
  preferredFocus = false,
}: {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  /** The keyboard's search key: the query is kept as a recent search. */
  readonly onSubmit: () => void;
  readonly autoFocus?: boolean;
  /** Takes focus first when the screen opens (TV). */
  readonly preferredFocus?: boolean;
}) => {
  const { colors, tokens, em, fonts, isTV } = useTheme();
  const input = tokens.components.input;
  const [active, setActive] = useState(false);
  const fontSize = (isTV ? 1.4 : 1) * em;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.6 * fontSize,
        backgroundColor: colors.surface,
        borderWidth: 2,
        borderColor: active ? input.activeBorder : input.border,
        borderRadius: 0.6 * fontSize,
        paddingHorizontal: 0.8 * fontSize,
      }}
    >
      <Icon name="search" size={1.1 * fontSize} color={active ? colors.fg : colors.fg3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        hasTVPreferredFocus={preferredFocus}
        accessibilityLabel={m.palette_label()}
        placeholder={m.shell_search_placeholder()}
        placeholderTextColor={colors.fg3}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        style={{
          flex: 1,
          fontFamily: fonts.fUi,
          fontSize,
          color: colors.fg,
          paddingVertical: 0.6 * fontSize,
        }}
      />
    </View>
  );
};
