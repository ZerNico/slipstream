import { Stack } from "expo-router";
import { useTheme } from "../../../src/theme/theme.ts";

/**
 * The Settings tab's own stack (phones): each section pushes inside the tab, so the tab bar
 * stays and Back walks up. The TV shows only the first page.
 */
export default function SettingsLayout() {
  const { colors, isTV } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        // On TV each page draws the rail itself: a fade keeps it in place where Android's
        // zoom would carry it along with the page.
        animation: isTV ? "fade" : "default",
      }}
    />
  );
}
