import { formatters, m } from "@slipstream/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";
import { isPin, pinLength } from "@slipstream/domain";
import { type PinResult, typePinDigit } from "../session/accounts.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { useDigitKeys } from "../tv/digit-keys.ts";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Icon } from "../ui/Icon.tsx";

/** The keypad rows: digits, then delete and 0 under them. */
const ROWS: readonly (readonly number[])[] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];

/** What the line under the dots says after a check. */
const problemText = (result: PinResult | undefined): string => {
  if (result === undefined) return "";
  switch (result._tag) {
    case "Wrong":
      return m.profile_pin_wrong();
    case "RateLimited":
      return m.signin_rate_limited({ seconds: result.retryAfterSeconds });
    case "Failed":
      return m.error_unexpected();
    case "Accepted":
    case "SignedOut":
      return "";
  }
};

/**
 * The PIN step of "Who's watching?" for a profile with a PIN: four dots and a keypad the D-pad
 * walks (digit keys on the remote type too). The fourth digit sends the PIN to the server as
 * that profile; only a PIN the server accepted switches to it. A wrong PIN clears the dots;
 * too many wrong ones say how long to wait. Back or Cancel returns to the picker.
 */
export const PinEntry = ({
  userId,
  name,
  onCancel,
}: {
  readonly userId: string;
  readonly name: string;
  readonly onCancel: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const { unlockProfile } = useSession();
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<PinResult | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const check = useCallback(
    (full: string) => {
      setChecking(true);
      unlockProfile(userId, full)
        .then((answer) => {
          if (!mounted.current) return;
          setChecking(false);
          setResult(answer);
          setPin("");
          if (answer._tag === "SignedOut") onCancel();
        })
        .catch(() => undefined);
    },
    [unlockProfile, userId, onCancel],
  );

  const type = useCallback(
    (key: number | "delete") => {
      if (checking) return;
      const next = typePinDigit(pin, key);
      setPin(next);
      if (next !== pin && key !== "delete") setResult(undefined);
      if (next !== pin && isPin(next)) check(next);
    },
    [checking, pin, check],
  );
  useDigitKeys(type, true);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

  const f = formatters();
  const problem = problemText(result);
  const dot = 1.4 * em;
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 2 * em },
      ]}
    >
      <View style={{ alignItems: "center", gap: 0.5 * em }}>
        <Icon name="lock" size={2 * em} color={colors.fg2} />
        <Text style={{ fontFamily: fonts.fDisplay, fontSize: 3 * em, color: colors.fg }}>
          {name.toUpperCase()}
        </Text>
        <Text style={{ fontFamily: fonts.fUi, fontSize: 1.15 * em, color: colors.fg2 }}>
          {m.profile_pin_enter()}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: em }} accessibilityLabel={m.profile_pin_format()}>
        {Array.from({ length: pinLength }, (_, index) => (
          <View
            key={index}
            style={{
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              borderWidth: 0.15 * em,
              borderColor: problem === "" ? colors.fg2 : colors.warn,
              backgroundColor: index < pin.length ? colors.fg : "transparent",
            }}
          />
        ))}
      </View>
      {/* One line kept even when empty, so the keypad never moves. */}
      <Text
        style={{
          minHeight: 1.4 * em,
          fontFamily: fonts.fUi,
          fontSize: em,
          color: colors.warnText,
        }}
      >
        {checking ? m.loading() : problem}
      </Text>
      <View style={{ gap: 0.6 * em }}>
        {ROWS.map((row, rowIndex) => (
          <View key={row.join("")} style={{ flexDirection: "row", gap: 0.6 * em }}>
            {row.map((digit, index) => (
              <View key={digit} style={{ width: 5 * em }}>
                <FocusButton
                  label={f.number(digit)}
                  preferredFocus={rowIndex === 0 && index === 0}
                  onPress={() => type(digit)}
                />
              </View>
            ))}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 0.6 * em }}>
          <View style={{ width: 5 * em }}>
            <FocusButton label={m.action_cancel()} variant="ghost" onPress={onCancel} />
          </View>
          <View style={{ width: 5 * em }}>
            <FocusButton label={f.number(0)} onPress={() => type(0)} />
          </View>
          <View style={{ width: 5 * em }}>
            <FocusButton label={m.action_delete()} variant="ghost" onPress={() => type("delete")} />
          </View>
        </View>
      </View>
    </View>
  );
};
