import { m } from "@slipstream/i18n";
import { Effect } from "effect";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Api, makeApiRuntime, normaliseServerUrl } from "../api/client.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { OptionRow } from "../ui/OptionRow.tsx";
import { AuthHeader } from "../ui/AuthHeader.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { TextField } from "../ui/TextField.tsx";
import { useDiscovery } from "./use-discovery.ts";

/** Asks `/api/health` whether a Slipstream server answers at `url`. */
const probe = async (url: string): Promise<boolean> => {
  const runtime = makeApiRuntime({ baseUrl: url, token: undefined });
  try {
    const health = await runtime.runPromise(
      Effect.flatMap(Api, (api) => api.system.health()).pipe(Effect.timeout("5 seconds")),
    );
    return health.status === "ok";
  } catch {
    return false;
  } finally {
    await runtime.dispose();
  }
};

/** What the manual address has come to: nothing yet, not an address, or no answer there. */
type AddressProblem =
  | { readonly kind: "invalid" }
  | { readonly kind: "unreachable"; readonly host: string };

/**
 * Picks the server (PLAN 6.9), under the mark: the Slipstream servers mDNS finds on the
 * LAN as rows to pick (the first one focused), a quiet line while it looks or when it found
 * none, and an address typed by hand. Connect stays off until there is something to try; an
 * entry that is no address says so under the field, and one that does not answer names the
 * address it tried.
 */
const ConnectBody = ({ onRetry }: { readonly onRetry: () => void }) => {
  const { colors, em, fonts, isTV, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const { chooseServer } = useSession();
  const discovery = useDiscovery();
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<AddressProblem | undefined>(undefined);
  const size = isTV ? 1.2 : 1;
  const ready = address.trim() !== "" && !checking;

  const connect = () => {
    if (!ready) return;
    const url = normaliseServerUrl(address);
    if (url === undefined) {
      setProblem({ kind: "invalid" });
      return;
    }
    setChecking(true);
    setProblem(undefined);
    probe(url)
      .then((ok) => {
        setChecking(false);
        if (ok) chooseServer({ url, name: new URL(url).hostname });
        else setProblem({ kind: "unreachable", host: new URL(url).host });
      })
      .catch(() => setChecking(false));
  };

  const nothingFound = !discovery.scanning && discovery.servers.length === 0;

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
        <AuthHeader title={m.signin_connect_title()} />
        {discovery.servers.length > 0 ? (
          <View
            style={{
              borderRadius: radii.rL,
              backgroundColor: colors.surface,
              padding: 0.4 * em,
              gap: 0.2 * em,
            }}
          >
            {discovery.servers.map((server, index) => (
              <OptionRow
                key={server.name}
                icon="live"
                title={server.name}
                hint={server.address}
                preferredFocus={index === 0}
                onPress={() => chooseServer({ url: server.url, name: server.name })}
              />
            ))}
          </View>
        ) : null}
        {discovery.scanning ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 0.8 * em }}>
            <ActivityIndicator color={colors.fg2} />
            <Text style={{ fontFamily: fonts.fUi, fontSize: size * em, color: colors.fg2 }}>
              {m.signin_searching()}
            </Text>
          </View>
        ) : nothingFound || discovery.failed ? (
          <Text style={{ fontFamily: fonts.fUi, fontSize: size * em, color: colors.fg2 }}>
            {m.signin_no_server()}
          </Text>
        ) : null}
        {manual ? (
          <View style={{ gap: 0.8 * em }}>
            <TextField
              label={m.signin_address()}
              value={address}
              onChangeText={(next) => {
                setAddress(next);
                setProblem(undefined);
              }}
              onSubmitEditing={connect}
              keyboardType="url"
              returnKeyType="go"
              autoFocus
            />
            {problem === undefined ? null : problem.kind === "invalid" ? (
              <Text style={{ fontFamily: fonts.fUi, fontSize: size * em, color: colors.warnText }}>
                {m.signin_address_invalid()}
              </Text>
            ) : (
              <View style={{ gap: 0.2 * em }}>
                <Text
                  style={{
                    fontFamily: fonts.fUiSemiBold,
                    fontSize: size * em,
                    color: colors.warnText,
                  }}
                >
                  {m.error_unreachable_title({ server: problem.host })}
                </Text>
                <Text style={{ fontFamily: fonts.fUi, fontSize: size * em, color: colors.fg2 }}>
                  {m.error_unreachable_body()}
                </Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: em, alignItems: "center" }}>
              <FocusButton
                label={checking ? m.signin_connecting() : m.signin_connect()}
                variant="primary"
                size={size}
                disabled={!ready}
                onPress={connect}
              />
              {checking ? <ActivityIndicator color={colors.fg2} /> : null}
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: em }}>
            <FocusButton
              label={m.signin_enter_address()}
              variant={discovery.servers.length === 0 ? "primary" : "default"}
              size={size}
              preferredFocus={nothingFound}
              onPress={() => setManual(true)}
            />
            {discovery.scanning ? null : (
              <FocusButton
                label={m.action_try_again()}
                variant="ghost"
                size={size}
                onPress={onRetry}
              />
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
};

/** The connect screen; "Try again" remounts it, which starts a fresh scan. */
export const ConnectScreen = () => {
  const [attempt, setAttempt] = useState(0);
  return <ConnectBody key={attempt} onRetry={() => setAttempt((value) => value + 1)} />;
};
