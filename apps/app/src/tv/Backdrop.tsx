import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { type ArtworkSubject, pictureFor } from "../data/artwork.ts";
import { useTheme } from "../theme/theme.ts";
import { Artwork } from "../ui/Artwork.tsx";

/**
 * The TV screen's backdrop (Infuse, Torsher): the focused programme's picture across the whole
 * screen, fading into the background to the left and to the bottom so the title on it and the
 * rows under it stay readable. Without a picture it stays the plain dark ground: a channel
 * logo blown up behind the rows reads as broken.
 */
export const Backdrop = ({ subject }: { readonly subject: ArtworkSubject | undefined }) => {
  const { colors, em } = useTheme();
  const bg = colors.bg;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {subject === undefined || pictureFor(subject) === undefined ? null : (
        <View style={[StyleSheet.absoluteFill, { left: "30%" }]}>
          <Artwork subject={subject} logoHeight={8 * em} />
        </View>
      )}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="side" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={bg} stopOpacity="1" />
            <Stop offset="0.38" stopColor={bg} stopOpacity="1" />
            <Stop offset="0.62" stopColor={bg} stopOpacity="0.55" />
            <Stop offset="1" stopColor={bg} stopOpacity="0.05" />
          </LinearGradient>
          <LinearGradient id="foot" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.35" stopColor={bg} stopOpacity="0" />
            <Stop offset="0.62" stopColor={bg} stopOpacity="0.85" />
            <Stop offset="1" stopColor={bg} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#side)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#foot)" />
      </Svg>
    </View>
  );
};
