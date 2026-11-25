import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { resolveServerUrl } from "../api/client.ts";
import { type ArtworkSubject, pictureFor } from "../data/artwork.ts";
import { useSession } from "../session/session-context.ts";
import { useTheme } from "../theme/theme.ts";
import { ChannelArt } from "./ChannelArt.tsx";

/**
 * A programme's or recording's picture filling its box (`pictureFor`: guide image, TMDB, a
 * frame from the recording), cropped to cover. Without one, or when it fails to load, the
 * channel's logo on a quiet card stands in, the web's channel card. Frames come from our server
 * with the device token; outside pictures load as they are. Pictures are cached on disk and fade
 * in over the card, so a list scrolling back never flashes.
 */
export const Artwork = ({
  subject,
  logoHeight,
}: {
  readonly subject: ArtworkSubject;
  /** The stand-in logo's height in dp. */
  readonly logoHeight: number;
}) => {
  const { colors } = useTheme();
  const { stored, account } = useSession();
  const picture = pictureFor(subject);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const base = stored.server?.url;
  const source =
    picture === undefined
      ? undefined
      : picture.kind === "outside"
        ? { uri: picture.uri }
        : base === undefined
          ? undefined
          : {
              uri: resolveServerUrl(base, picture.path),
              ...(account === undefined
                ? {}
                : { headers: { Authorization: `Bearer ${account.token}` } }),
            };
  const shown = source !== undefined && source.uri !== failed ? source : undefined;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.raised }]}>
      {shown === undefined ? (
        <ChannelArt channelId={subject.channelId} height={logoHeight} />
      ) : (
        <Image
          source={shown}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
          cachePolicy="memory-disk"
          recyclingKey={shown.uri}
          onError={() => setFailed(shown.uri)}
        />
      )}
    </View>
  );
};
