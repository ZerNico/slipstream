import { channelMark } from "@slipstream/domain";
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { useTheme } from "../../../theme/theme.ts";

/** A heading over a group of rows. */
export const GroupHeading = ({ text }: { readonly text: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      style={{
        fontFamily: fonts.fUiSemiBold,
        fontSize: 1.05 * em,
        color: colors.fg,
        paddingHorizontal: em,
        paddingTop: 1.3 * em,
        paddingBottom: 0.5 * em,
      }}
    >
      {text}
    </Text>
  );
};

/** What a test, refresh or save answered: found (ok) or why not (error). */
export const ResultNote = ({
  tone,
  children,
}: {
  readonly tone: "ok" | "error";
  readonly children: string;
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      style={{
        fontFamily: fonts.fUi,
        fontSize: 0.88 * em,
        color: tone === "ok" ? colors.okText : colors.liveText,
      }}
    >
      {children}
    </Text>
  );
};

/**
 * A channel's logo in a box of `size` dp height (1.6 wide): the picture, else the channel's
 * short mark. A logo that fails to load falls back to the mark.
 */
export const ChannelLogo = ({
  name,
  logoUrl,
  size,
}: {
  readonly name: string;
  readonly logoUrl: string | undefined;
  readonly size: number;
}) => {
  const { colors, fonts, radii } = useTheme();
  const [broken, setBroken] = useState<string | undefined>(undefined);
  const logo = logoUrl !== undefined && logoUrl !== broken ? logoUrl : undefined;
  const width = size * 1.6;
  return (
    <View
      style={{
        width,
        height: size,
        borderRadius: radii.rM,
        backgroundColor: colors.raised,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {logo === undefined ? (
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.fDisplay, fontSize: size * 0.5, color: colors.fg3 }}
        >
          {channelMark(name)}
        </Text>
      ) : /\.svg(?:$|[?#])/iu.test(logo) ? (
        // `Image` cannot draw SVG.
        <SvgUri
          uri={logo}
          width={width * 0.8}
          height={size * 0.8}
          onError={() => setBroken(logo)}
        />
      ) : (
        <Image
          source={{ uri: logo }}
          style={{ width: width * 0.8, height: size * 0.8 }}
          resizeMode="contain"
          onError={() => setBroken(logo)}
        />
      )}
    </View>
  );
};
