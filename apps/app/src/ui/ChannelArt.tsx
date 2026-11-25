import type { ChannelId } from "@slipstream/domain";
import { channelMark } from "@slipstream/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { useApiQueries } from "../data/hooks.ts";
import { useTheme } from "../theme/theme.ts";

/**
 * A programme without a picture shows its channel (as on the web): the logo centred in the
 * thumbnail, else the channel's short mark in the display face. A logo that fails to load falls
 * back to the mark. `height` is the logo's box in dp; the mark is set to fit it.
 */
export const ChannelArt = ({
  channelId,
  height,
}: {
  readonly channelId: ChannelId;
  readonly height: number;
}) => {
  const { colors, fonts } = useTheme();
  const queries = useApiQueries();
  const channels = useQuery(queries.channels());
  const channel = channels.data?.find((candidate) => candidate.id === channelId);
  const [broken, setBroken] = useState<string | undefined>(undefined);
  const logo =
    channel?.logoUrl !== undefined && channel.logoUrl !== broken ? channel.logoUrl : undefined;
  const width = height * 1.6;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}
    >
      {logo === undefined ? (
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.fDisplay,
            fontSize: height * 0.75,
            color: colors.fg3,
          }}
        >
          {channel === undefined ? "" : channelMark(channel.name)}
        </Text>
      ) : /\.svg(?:$|[?#])/iu.test(logo) ? (
        // `Image` cannot draw SVG.

        <SvgUri uri={logo} width={width} height={height} onError={() => setBroken(logo)} />
      ) : (
        <Image
          source={{ uri: logo }}
          style={{ width, height }}
          resizeMode="contain"
          onError={() => setBroken(logo)}
        />
      )}
    </View>
  );
};
