import { m } from "@slipstream/i18n";
import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";

const tabs: Readonly<Record<string, { readonly icon: IconName; readonly label: () => string }>> = {
  index: { icon: "home", label: () => m.nav_home() },
  guide: { icon: "guide", label: () => m.nav_guide() },
  recordings: { icon: "rec", label: () => m.nav_recordings() },
  settings: { icon: "gear", label: () => m.nav_settings() },
};

/**
 * The phone's tab bar (the web's phone tab bar), drawn for the tabs layout: Home, Guide,
 * Recordings and Settings at the thumb, each an icon over its word, the current one in the
 * foreground with its icon in amber. Switching tabs swaps the screen in place; nothing stacks.
 */
export const PhoneTabBar = ({ state, navigateToTab }: BottomTabBarProps) => {
  const { colors, em, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        height: 3.9 * em + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      {state.routes.map((route, index) => {
        const tab = tabs[route.name];
        // Every tab has an entry; a route without one draws nothing.
        if (tab === undefined) return null;
        const active = index === state.index;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label()}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) navigateToTab(route.key);
            }}
            style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 0.25 * em }}
          >
            <Icon name={tab.icon} size={1.5 * em} color={active ? colors.brand : colors.fg3} />
            <Text
              style={{
                fontFamily: active ? fonts.fUiSemiBold : fonts.fUi,
                fontSize: 0.78 * em,
                color: active ? colors.fg : colors.fg3,
              }}
            >
              {tab.label()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};
