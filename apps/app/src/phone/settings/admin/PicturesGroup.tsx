import { m } from "@slipstream/i18n";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { Alert, Text, View } from "react-native";
import { queryKeys } from "../../../api/keys.ts";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { FocusButton } from "../../../ui/FocusButton.tsx";
import { TextField } from "../../../ui/TextField.tsx";
import { useToast } from "../../../ui/toast.ts";
import { adminSettingsActions, tmdbProblem } from "./api.ts";
import { Group, Row } from "./parts.tsx";

/** Where TMDB hands out keys. */
const TMDB_KEYS_URL = "https://www.themoviedb.org/settings/api";

/**
 * Pictures from TMDB: a key connects it, and from then on films and series without a guide
 * picture get one. Connect is explicit (the server tries the key first); the key is never shown
 * again, and Disconnect asks first. TMDB asks for the attribution line under it.
 */
export const PicturesGroup = ({ connected }: { readonly connected: boolean }) => {
  const { colors, em, fonts } = useTheme();
  const { runAction } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const save = (tmdbKey: string | null) => {
    setBusy(true);
    setProblem(undefined);
    runAction(adminSettingsActions.saveArtwork(tmdbKey))
      .then((saved) => {
        queryClient.setQueryData(queryKeys.artworkSettings, saved);
        setKey("");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({ text: saved.tmdb ? m.rec_tmdb_connected() : m.settings_saved() });
      })
      .catch((error: unknown) => {
        if (tmdbKey === null) toast({ text: m.state_not_saved() });
        else setProblem(tmdbProblem(error));
      })
      .finally(() => setBusy(false));
  };
  const connect = () => {
    const trimmed = key.trim();
    if (trimmed === "" || busy) return;
    save(trimmed);
  };
  const askDisconnect = () =>
    Alert.alert(m.settings_tmdb_disconnect_question(), m.settings_tmdb_disconnect_text(), [
      { text: m.action_cancel(), style: "cancel" },
      { text: m.rec_tmdb_remove(), style: "destructive", onPress: () => save(null) },
    ]);

  return (
    <Group title={m.rec_pictures_title()} footer={m.rec_tmdb_attribution()}>
      {connected ? (
        <Row title={m.rec_tmdb()} sub={m.rec_tmdb_connected()} />
      ) : (
        <Row
          title={m.rec_tmdb()}
          sub={m.rec_tmdb_get_key()}
          label={m.rec_tmdb_get_key()}
          onPress={() => void WebBrowser.openBrowserAsync(TMDB_KEYS_URL)}
        />
      )}
      {connected ? (
        <Row title={m.rec_tmdb_remove()} tone="danger" onPress={busy ? undefined : askDisconnect} />
      ) : (
        <View style={{ paddingHorizontal: em, paddingTop: 0.8 * em, gap: 0.5 * em }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 0.6 * em }}>
            <View style={{ flex: 1 }}>
              <TextField
                label={m.rec_tmdb_key()}
                value={key}
                secureTextEntry
                autoComplete="off"
                returnKeyType="go"
                onChangeText={(next) => {
                  setKey(next);
                  setProblem(undefined);
                }}
                onSubmitEditing={connect}
              />
            </View>
            <FocusButton
              label={m.rec_tmdb_connect()}
              variant="primary"
              size={0.9}
              disabled={key.trim() === "" || busy}
              onPress={connect}
            />
          </View>
          {/* Kept even when empty, so a refusal never moves the rows. */}
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontFamily: fonts.fUi,
              fontSize: 0.85 * em,
              lineHeight: 1.2 * em,
              minHeight: 1.2 * em,
              marginBottom: 0.5 * em,
              color: colors.liveText,
            }}
          >
            {problem ?? ""}
          </Text>
        </View>
      )}
    </Group>
  );
};
