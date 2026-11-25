import { m } from "@slipstream/i18n";
import type { Href } from "expo-router";
import { Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { tokenTheme } from "../theme/palette.ts";
import { useTheme } from "../theme/theme.ts";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { phoneLink } from "../routes.ts";

/** QR codes scan best dark on light, so the code uses the light theme in every theme. */
const qrColours = tokenTheme("light").colors;

/**
 * "Open on your phone": a side sheet with a QR code of a deep link into the phone app
 * (`slipstream://settings/sources`), what to do with it, and the link spelled out small. For
 * what a remote cannot do well: typing conditions, a new series recording, the household's
 * settings. The phone opens the page once someone is signed in there.
 */
export const PhoneHandoff = ({
  title,
  path,
  onClose,
}: {
  /** What opens on the phone ("Sources & channels"). */
  readonly title: string;
  /** The phone page, as `/settings/sources`. */
  readonly path: Href;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts, radii } = useTheme();
  const link = phoneLink(path);
  const qrSize = 13 * em;
  return (
    <Sheet label={title} onClose={onClose}>
      <Text
        numberOfLines={2}
        style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.6 * em, color: colors.fg }}
      >
        {title}
      </Text>
      <Text style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg2 }}>
        {m.handoff_scan()}
      </Text>
      <View
        style={{
          alignSelf: "flex-start",
          marginTop: 0.6 * em,
          padding: em,
          borderRadius: radii.rM,
          backgroundColor: qrColours.bg.surface,
        }}
      >
        <QRCode
          value={link}
          size={qrSize}
          ecl="M"
          color={qrColours.fg.default}
          backgroundColor={qrColours.bg.surface}
        />
      </View>
      <Text
        numberOfLines={2}
        style={{ fontFamily: fonts.fMono, fontSize: 0.85 * em, color: colors.fg3 }}
      >
        {link}
      </Text>
      <View style={{ marginTop: em }}>
        <FocusButton label={m.action_close()} preferredFocus onPress={onClose} />
      </View>
    </Sheet>
  );
};
