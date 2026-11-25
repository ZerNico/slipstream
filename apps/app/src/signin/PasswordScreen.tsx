import { m } from "@slipstream/i18n";
import { Effect } from "effect";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Api } from "../api/client.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { AuthHeader } from "../ui/AuthHeader.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { TextField } from "../ui/TextField.tsx";
import { thisDevice } from "./device.ts";

/** The message for a failed password sign-in. */
const problemText = (error: unknown): string => {
  const failure = error as { readonly _tag?: string; readonly retryAfterSeconds?: number };
  const tag: string = failure._tag ?? "";
  switch (tag) {
    case "InvalidCredentials":
      return m.signin_wrong();
    case "RateLimited":
      return m.signin_rate_limited({ seconds: failure.retryAfterSeconds ?? 60 });
    case "SetupRequired":
      return m.signin_setup_first();
    default:
      return m.signin_failed();
  }
};

/**
 * Username and password sign-in (PLAN 6.9): on a phone the way in, on TV the fallback for when
 * no phone is at hand. Under the mark like the connect screen; Sign in stays off until
 * both fields hold something, and a refusal is said under them.
 */
export const PasswordScreen = () => {
  const { colors, em, fonts, isTV } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { publicRuntime, signedIn, stored, forgetServer, addingProfile, cancelAddProfile } =
    useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const size = isTV ? 1.2 : 1;
  const ready = username.trim() !== "" && password !== "" && !busy;

  const submit = () => {
    if (publicRuntime === undefined || !ready) return;
    setBusy(true);
    setProblem(undefined);
    publicRuntime
      .runPromise(
        Effect.flatMap(Api, (api) =>
          api.auth.login({
            payload: { username: username.trim(), password, device: thisDevice() },
          }),
        ),
      )
      .then((result) => {
        setBusy(false);
        signedIn(result);
      })
      .catch((error: unknown) => {
        setBusy(false);
        setProblem(problemText(error));
      });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        // Anchored at a fixed height, not centred: a field or a message appearing below must
        // not move what is already there.
        flexGrow: 1,
        alignItems: "center",
        paddingTop: insets.top + (isTV ? 7 : 9) * em,
        paddingBottom: insets.bottom + 2 * em,
        paddingHorizontal: 1.5 * em,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ width: "100%", maxWidth: (isTV ? 40 : 28) * em, gap: 1.6 * size * em }}>
        <AuthHeader title={m.signin_title()} lead={stored.server?.name} />
        <View style={{ gap: 0.8 * em }}>
          <TextField
            label={m.signin_username()}
            value={username}
            onChangeText={(next) => {
              setUsername(next);
              setProblem(undefined);
            }}
            autoComplete="username"
            returnKeyType="next"
            autoFocus
          />
          <TextField
            label={m.signin_password()}
            value={password}
            onChangeText={(next) => {
              setPassword(next);
              setProblem(undefined);
            }}
            onSubmitEditing={submit}
            autoComplete="current-password"
            returnKeyType="go"
            secureTextEntry
          />
          {problem === undefined ? null : (
            <Text style={{ fontFamily: fonts.fUi, fontSize: size * em, color: colors.warnText }}>
              {problem}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: em, alignItems: "center" }}>
          <FocusButton
            label={m.signin_submit()}
            variant="primary"
            size={size}
            disabled={!ready}
            onPress={submit}
          />
          {busy ? <ActivityIndicator color={colors.fg2} /> : null}
          {isTV ? (
            <FocusButton
              label={m.action_back()}
              variant="ghost"
              size={size}
              onPress={() => router.back()}
            />
          ) : addingProfile && stored.accounts.length > 0 ? (
            <FocusButton label={m.action_cancel()} variant="ghost" onPress={cancelAddProfile} />
          ) : (
            <FocusButton label={m.error_choose_server()} variant="ghost" onPress={forgetServer} />
          )}
        </View>
      </View>
    </ScrollView>
  );
};
