import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";

/**
 * A full screen that says one thing: loading, nothing here yet, or what went wrong and what to
 * do. `actions` are buttons below the message.
 */
export const StatusScreen = ({
  title,
  body,
  busy = false,
  actions,
}: {
  readonly title: string;
  readonly body?: string | undefined;
  readonly busy?: boolean;
  readonly actions?: ReactNode;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.bg,
          alignItems: isTV ? "flex-start" : "stretch",
          justifyContent: "center",
          paddingHorizontal: (isTV ? 8 : 1.5) * em,
          gap: em,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={colors.fg2} size="large" /> : null}
      <Text
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: (isTV ? 2 : 1.3) * em,
          color: colors.fg,
          maxWidth: isTV ? 50 * em : undefined,
        }}
      >
        {title}
      </Text>
      {body === undefined ? null : (
        <Text
          style={{
            fontFamily: fonts.fUi,
            fontSize: (isTV ? 1.2 : 1) * em,
            color: colors.fg2,
            maxWidth: isTV ? 50 * em : undefined,
          }}
        >
          {body}
        </Text>
      )}
      {actions === undefined ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: em, marginTop: em }}>
          {actions}
        </View>
      )}
    </View>
  );
};
