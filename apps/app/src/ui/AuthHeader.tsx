import { m } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { BrandMark } from "./BrandMark.tsx";

/**
 * The head of the screens before you are in (connect, sign in): the mark and the wordmark, then
 * a plain title in sentence case and, when there is one, a quiet line under it. One look for
 * the whole way in, on TV and phone.
 */
export const AuthHeader = ({
  title,
  lead,
}: {
  readonly title: string;
  readonly lead?: string | undefined;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  const scale = isTV ? 1.35 : 1;
  return (
    <View style={{ gap: 1.1 * scale * em }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0.55 * scale * em }}>
        <BrandMark size={2 * scale * em} />
        <Text
          style={{
            fontFamily: fonts.fDisplay,
            fontSize: 1.45 * scale * em,
            letterSpacing: 0.04 * em,
            color: colors.fg,
          }}
        >
          {m.app_name().toUpperCase()}
        </Text>
      </View>
      <View style={{ gap: 0.4 * scale * em }}>
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.6 * scale * em,
            lineHeight: 2 * scale * em,
            color: colors.fg,
          }}
        >
          {title}
        </Text>
        {lead === undefined ? null : (
          <Text style={{ fontFamily: fonts.fUi, fontSize: scale * em, color: colors.fg2 }}>
            {lead}
          </Text>
        )}
      </View>
    </View>
  );
};
