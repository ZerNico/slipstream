// What Hermes lacks of ES2023, before any module that uses it.
import "../src/polyfills.ts";
// Per-weight entry points, so only these font files end up in the bundle.
import { BigShoulders_700Bold } from "@expo-google-fonts/big-shoulders/700Bold";
import { BigShoulders_800ExtraBold } from "@expo-google-fonts/big-shoulders/800ExtraBold";
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono/400Regular";
import { GeistMono_600SemiBold } from "@expo-google-fonts/geist-mono/600SemiBold";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  makeQueryClient,
  makeUnauthorizedSignal,
  type UnauthorizedSignal,
} from "../src/api/query-client.ts";
import { connectQueryToApp } from "../src/api/app-state.ts";
import { usePendingDeviceLink } from "../src/approve/use-pending-link.ts";
import { applyDeviceLocale, useFollowDeviceLanguage } from "../src/i18n/locale.ts";
import { playerPrefs } from "../src/player/player-prefs.ts";
import { recentSearches } from "../src/search/use-search.ts";
import { lastUsedAccount } from "../src/session/accounts.ts";
import { HouseholdZone } from "../src/session/HouseholdZone.tsx";
import { ReminderProvider } from "../src/session/ReminderProvider.tsx";
import { useSession } from "../src/session/session-context.ts";
import { SessionProvider } from "../src/session/SessionProvider.tsx";
import { useTheme } from "../src/theme/theme.ts";
import { ToastHost } from "../src/ui/ToastHost.tsx";

applyDeviceLocale();
// Foreground and network state drive TanStack Query, as the browser does on the web.
connectQueryToApp();
// @gorhom/bottom-sheet passes dependency arrays to Reanimated, which native ignores; the
// library's warning is not ours to fix and would cover the sheets in development.
LogBox.ignoreLogs([/Dependencies should only be used on the web/u]);
// This device's player Fit/Fill and quality and its recent searches; empty until they are read.
void playerPrefs.load(SecureStore);
void recentSearches.load(SecureStore);
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * The screens, guarded by where the device is in setup: pick a server, sign in, pick a profile
 * on shared TVs, then the app itself. Each guard redirects to the first screen it allows.
 */
const Screens = ({ unauthorized }: { readonly unauthorized: UnauthorizedSignal }) => {
  const { colors, isTV } = useTheme();
  const { loaded, stored, account, needsPicker, tokenRejected } = useSession();
  const hasServer = stored.server !== undefined;
  const ready = account !== undefined;
  usePendingDeviceLink(ready);
  // A revoked or expired token: forget the profile whose token reads (while "Who's watching?"
  // shows, the one used last), and the guards below move on to the picker or sign-in.
  const tokenUserId =
    account?.userId ?? (needsPicker ? lastUsedAccount(stored)?.userId : undefined);
  useEffect(
    () =>
      tokenUserId === undefined ? undefined : unauthorized.listen(() => tokenRejected(tokenUserId)),
    [unauthorized, tokenUserId, tokenRejected],
  );
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);
  if (!loaded) return null;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: isTV ? "fade" : "default",
      }}
    >
      <Stack.Protected guard={!hasServer}>
        <Stack.Screen name="connect" />
      </Stack.Protected>
      <Stack.Protected guard={hasServer && needsPicker}>
        <Stack.Screen name="profiles" />
      </Stack.Protected>
      <Stack.Protected guard={hasServer && !needsPicker && !ready}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-in-password" />
      </Stack.Protected>
      <Stack.Protected guard={ready}>
        {/* Home, Guide, Recordings and Settings: tabs, so moving between them never stacks. */}
        <Stack.Screen name="(tabs)" />
        {/* Above the tabs, so Back returns to whatever opened it. */}
        <Stack.Screen name="search" />
        <Stack.Screen name="player" />
        <Stack.Screen name="link" />
      </Stack.Protected>
    </Stack>
  );
};

/**
 * Root layout: gestures, fonts, the query cache, the session (server, profiles, live events), the
 * household's time zone, the toasts and the reminder notices around every screen.
 */
export default function RootLayout() {
  useFollowDeviceLanguage();
  const { colors, isTV } = useTheme();
  const [unauthorized] = useState(makeUnauthorizedSignal);
  const [queryClient] = useState(() => makeQueryClient(unauthorized));
  const [fontsLoaded, fontError] = useFonts({
    BigShoulders_700Bold,
    BigShoulders_800ExtraBold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_600SemiBold,
  });
  // Without the fonts the system font still renders everything; never block on a load error.
  if (!fontsLoaded && fontError === null) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
        <StatusBar style={isTV ? "light" : "auto"} hidden={isTV} />
        <QueryClientProvider client={queryClient}>
          <ToastHost>
            <SessionProvider unauthorized={unauthorized}>
              <HouseholdZone>
                <ReminderProvider>
                  {/* Phone sheets render here, inside the session, toasts and reminders they use. */}
                  <BottomSheetModalProvider>
                    <Screens unauthorized={unauthorized} />
                  </BottomSheetModalProvider>
                </ReminderProvider>
              </HouseholdZone>
            </SessionProvider>
          </ToastHost>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
