import { Stack } from "expo-router";
import { useTheme } from "../../../src/theme/theme.ts";

/**
 * The Recordings tab's own stack (phones): the library, a place, a recording, Scheduled and
 * Problems push inside the tab, so the tab bar stays and Back walks up.
 */
export default function RecordingsLayout() {
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
