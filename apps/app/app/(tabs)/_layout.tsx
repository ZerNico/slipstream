import { type BottomTabBarProps, Tabs } from "expo-router/tabs";
import { PhoneTabBar } from "../../src/phone/PhoneTabBar.tsx";
import { useTheme } from "../../src/theme/theme.ts";

const phoneTabBar = (props: BottomTabBarProps) => <PhoneTabBar {...props} />;
// On TV the rail inside each screen is the navigation.
const noTabBar = () => null;

/**
 * Home, Guide, Recordings and Settings as tabs: switching swaps the screen in place with a short
 * fade (nothing stacks, each keeps its scroll), and Back from any of them goes Home. Phones get
 * the tab bar at the thumb; on TV the rail inside each screen moves between them instead.
 */
export default function TabsLayout() {
  const { colors, isTV } = useTheme();
  return (
    <Tabs
      backBehavior="firstRoute"
      tabBar={isTV ? noTabBar : phoneTabBar}
      screenOptions={{
        headerShown: false,
        animation: "fade",
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="guide" />
      <Tabs.Screen name="recordings" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
