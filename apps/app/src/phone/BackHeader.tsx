import { m } from "@slipstream/i18n";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme.ts";
import { Icon } from "../ui/Icon.tsx";

/**
 * The head of a page pushed inside a tab: Back at the left and the page's title next to it, in
 * one line under the status bar, and an optional action at the right. `floating` lays it over a
 * picture (no title, Back on a shade).
 */
export const BackHeader = ({
  title,
  floating = false,
  action,
}: {
  readonly title?: string;
  readonly floating?: boolean;
  /** One button at the right end ("New"). */
  readonly action?: ReactNode;
}) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        position: floating ? "absolute" : "relative",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 5,
        paddingTop: insets.top + 0.4 * em,
        paddingLeft: 0.5 * em,
        // The action at the right end keeps the page's own margin.
        paddingRight: em,
        paddingBottom: 0.4 * em,
        flexDirection: "row",
        alignItems: "center",
        gap: 0.3 * em,
        backgroundColor: floating ? "transparent" : colors.bg,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={m.action_back()}
        hitSlop={0.5 * em}
        onPress={() => router.back()}
        style={({ pressed }) => ({
          width: 2.6 * em,
          height: 2.6 * em,
          borderRadius: 1.3 * em,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: floating ? colors.scrim : pressed ? colors.surface : "transparent",
        })}
      >
        <Icon name="chevronLeft" size={1.5 * em} color={colors.fg} />
      </Pressable>
      {title === undefined || floating ? null : (
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          // It gives way to the action: a long title ends in "…" rather than running under it.
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.15 * em,
            color: colors.fg,
          }}
        >
          {title}
        </Text>
      )}
      {action}
    </View>
  );
};
