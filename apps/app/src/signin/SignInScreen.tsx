import { m } from "@slipstream/i18n";
import { Effect } from "effect";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../session/session-context.ts";
import { tokenTheme } from "../theme/palette.ts";
import { useTheme } from "../theme/theme.ts";
import { useReturnFocus } from "../tv/library/use-tv-navigation.ts";
import { AuthHeader } from "../ui/AuthHeader.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { useNow } from "../ui/use-now.ts";
import {
  DeviceCodeAuth,
  deviceCodeSignIn,
  secondsLeft,
  type DeviceCodeView,
} from "./device-code.ts";
import { thisDevice } from "./device.ts";
import { formatUserCode } from "@slipstream/api";

/** What went wrong, if anything, beside the code. */
type Problem = "denied" | "notSetUp" | "failed" | undefined;

/** The focus key of "Use password", which opens a screen of its own. */
const PASSWORD_KEY = "password";

/** After this long without a code, say the server may be unreachable. */
const SLOW_MS = 8000;

/** QR codes scan best dark on light, so the card uses the light theme in every theme. */
const qrColours = tokenTheme("light").colors;

/** "slipstream.home/link" from the verification URL, for people typing it by hand. */
const shortUrl = (url: string): string => url.replace(/^https?:\/\//u, "").replace(/[?#].*$/u, "");

/** One run of the device-code flow; "Try again" remounts it. */
const SignInBody = ({ onRetry }: { readonly onRetry: () => void }) => {
  const { colors, em, fonts, isTV, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { publicRuntime, stored, signedIn, forgetServer, addingProfile, cancelAddProfile } =
    useSession();
  const [view, setView] = useState<DeviceCodeView>({ _tag: "Requesting" });
  const [problem, setProblem] = useState<Problem>(undefined);
  const [startedAt] = useState(() => Date.now());
  const now = useNow(1000);
  // TV: focus on "Use password" (Try again after a problem), and back on it from that screen.
  const { target, opening } = useReturnFocus({
    keys: [PASSWORD_KEY],
    first: problem === undefined ? PASSWORD_KEY : undefined,
  });
  // The flow runs once per mount; the latest callback receives its result.
  const onSignedIn = useRef(signedIn);
  useEffect(() => {
    onSignedIn.current = signedIn;
  }, [signedIn]);

  useEffect(() => {
    if (publicRuntime === undefined) return;
    const controller = new AbortController();
    // The expected endings are values; only something unforeseen rejects.
    publicRuntime
      .runPromise(
        deviceCodeSignIn(thisDevice(), setView).pipe(
          Effect.map((result) => () => onSignedIn.current(result)),
          Effect.catchTags({
            SignInDenied: () => Effect.succeed(() => setProblem("denied")),
            ServerNotSetUp: () => Effect.succeed(() => setProblem("notSetUp")),
          }),
          Effect.provide(DeviceCodeAuth.layer),
        ),
        { signal: controller.signal },
      )
      .then((finish) => finish())
      .catch(() => {
        if (!controller.signal.aborted) setProblem("failed");
      });
    return () => controller.abort();
  }, [publicRuntime]);

  const server = stored.server;
  const code = view._tag === "Showing" ? view.code : undefined;
  const slow = view._tag === "Requesting" && now - startedAt > SLOW_MS;
  const qrSize = 12 * em;

  const problemText =
    problem === "denied"
      ? m.signin_denied()
      : problem === "notSetUp"
        ? m.signin_setup_first()
        : problem === "failed"
          ? m.signin_failed()
          : undefined;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + (isTV ? 4 : 2) * em,
        paddingBottom: insets.bottom + 2 * em,
        paddingHorizontal: (isTV ? 6 : 1.5) * em,
        flexDirection: isTV ? "row" : "column",
        gap: (isTV ? 5 : 1.5) * em,
      }}
    >
      <View style={{ flex: isTV ? 1 : undefined, gap: em }}>
        <AuthHeader title={m.signin_title()} lead={m.signin_scan()} />
        {code === undefined ? null : (
          <>
            <Text
              style={{ fontFamily: fonts.fUi, fontSize: (isTV ? 1.3 : 1) * em, color: colors.fg2 }}
            >
              {m.signin_or_open({ url: shortUrl(code.verificationUrl) })}
            </Text>
            <Text
              accessibilityLabel={code.userCode.split("").join(" ")}
              style={{
                fontFamily: fonts.fMonoSemiBold,
                fontSize: (isTV ? 4 : 2.4) * em,
                letterSpacing: 0.1 * em,
                color: colors.fg,
              }}
            >
              {formatUserCode(code.userCode)}
            </Text>
          </>
        )}
        {server === undefined ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 0.6 * em }}>
            <View
              style={{
                width: 0.6 * em,
                height: 0.6 * em,
                borderRadius: 0.3 * em,
                backgroundColor: colors.ok,
              }}
            />
            <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
              {m.signin_server_found({ name: server.name, address: new URL(server.url).host })}
            </Text>
          </View>
        )}
        {slow && server !== undefined ? (
          <View style={{ gap: 0.3 * em }}>
            <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: em, color: colors.fg }}>
              {m.error_unreachable_title({ server: server.name })}
            </Text>
            <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
              {m.error_unreachable_body()}
            </Text>
          </View>
        ) : null}
        {problemText === undefined ? null : (
          <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: em, color: colors.warnText }}>
            {problemText}
          </Text>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: em, marginTop: em }}>
          {problem === undefined ? null : (
            <FocusButton
              label={m.action_try_again()}
              // On TV amber is the focus alone.
              variant={isTV ? "default" : "primary"}
              preferredFocus={target !== PASSWORD_KEY}
              onPress={onRetry}
            />
          )}
          <FocusButton
            label={m.signin_use_password()}
            preferredFocus={target === PASSWORD_KEY}
            onPress={() => {
              opening(PASSWORD_KEY);
              router.push("/sign-in-password");
            }}
          />
          {addingProfile && stored.accounts.length > 0 ? (
            <FocusButton label={m.action_cancel()} variant="ghost" onPress={cancelAddProfile} />
          ) : (
            <FocusButton label={m.error_choose_server()} variant="ghost" onPress={forgetServer} />
          )}
        </View>
      </View>
      <View
        style={{
          alignSelf: isTV ? "center" : "flex-start",
          alignItems: "center",
          gap: 0.8 * em,
          padding: 1.2 * em,
          borderRadius: radii.rL,
          backgroundColor: colors.surface,
        }}
      >
        <View
          style={{
            padding: 0.8 * em,
            backgroundColor: qrColours.bg.surface,
            borderRadius: radii.rM,
          }}
        >
          {code === undefined ? (
            <View
              style={{
                width: qrSize,
                height: qrSize,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator color={qrColours.fg.muted} size="large" />
            </View>
          ) : (
            <QRCode
              value={code.verificationUrl}
              size={qrSize}
              ecl="M"
              color={qrColours.fg.default}
              backgroundColor={qrColours.bg.surface}
            />
          )}
        </View>
        {code === undefined ? null : (
          <Text style={{ fontFamily: fonts.fMono, fontSize: em, color: colors.fg2 }}>
            {m.signin_new_code({ seconds: secondsLeft(code, now) })}
          </Text>
        )}
      </View>
    </ScrollView>
  );
};

/**
 * TV sign-in (design doc "TV · Sign-in"): a QR code and a short code that a phone approves,
 * refreshed by itself when it expires, with username and password as the fallback. Phones use
 * the same flow.
 */
export const SignInScreen = () => {
  const [attempt, setAttempt] = useState(0);
  return <SignInBody key={attempt} onRetry={() => setAttempt((value) => value + 1)} />;
};
