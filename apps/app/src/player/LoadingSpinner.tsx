import { m } from "@slipstream/i18n";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useTheme } from "../theme/theme.ts";

/**
 * The player's one loading sign: a spinner in the middle of the picture, while the stream
 * starts and whenever it waits for data. It never takes a touch or the remote's focus.
 */
export const LoadingSpinner = ({ backdrop = false }: { readonly backdrop?: boolean }) => {
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={m.loading()}
      style={[
        StyleSheet.absoluteFill,
        {
          alignItems: "center",
          justifyContent: "center",
          ...(backdrop ? { backgroundColor: colors.bg } : {}),
        },
      ]}
    >
      <ActivityIndicator color={colors.fg} size="large" />
    </View>
  );
};
