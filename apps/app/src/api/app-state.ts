import { focusManager, onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { AppState, type AppStateStatus, Platform } from "react-native";

/**
 * Tells TanStack Query what the browser tells it on the web (its React Native guide): the app
 * coming back to the foreground counts as focus, so stale screens refetch after the phone slept
 * or a live event was missed; and a lost network connection counts as offline, so queries pause
 * and resume when it returns instead of failing. Call once at start.
 *
 * Only the connection counts, never whether the internet is reachable: the server is usually in
 * the same home network, and an internet outage (or a network without internet) is exactly when
 * local TV must keep working. Pausing on it left screens waiting forever.
 */
export const connectQueryToApp = (): void => {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      // The web build keeps the browser's own focus events.
      if (Platform.OS !== "web") setFocused(status === "active");
    });
    return () => subscription.remove();
  });
  onlineManager.setEventListener((setOnline) => {
    const subscription = Network.addNetworkStateListener((state) => {
      // Unknown counts as online, so a slow check never blocks a read.
      setOnline(state.isConnected !== false);
    });
    return () => subscription.remove();
  });
};
