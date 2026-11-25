import type { ReactNode } from "react";
import { View } from "react-native";
import type { ArtworkSubject } from "../data/artwork.ts";
import { useTheme } from "../theme/theme.ts";
import { Artwork } from "../ui/Artwork.tsx";

/**
 * A picture in a rounded 16:9 box (a phone card or row), with the watched share as an amber bar
 * inside it and an optional badge in the top left corner.
 */
export const Thumb = ({
  subject,
  progress = 0,
  width,
  badge,
}: {
  readonly subject: ArtworkSubject;
  readonly progress?: number;
  /** A number for a fixed width; omit to fill the parent's width. */
  readonly width?: number;
  readonly badge?: ReactNode;
}) => {
  const { colors, em, radii } = useTheme();
  const logo = 0.13 * (width ?? 12 * em);
  return (
    <View
      style={{
        width: width ?? "100%",
        aspectRatio: 16 / 9,
        borderRadius: radii.rM,
        overflow: "hidden",
        backgroundColor: colors.raised,
      }}
    >
      <Artwork subject={subject} logoHeight={logo} />
      {progress <= 0 ? null : (
        <View
          style={{
            position: "absolute",
            left: 0.6 * em,
            right: 0.6 * em,
            bottom: 0.5 * em,
            height: 0.25 * em,
            borderRadius: 0.25 * em,
            overflow: "hidden",
            backgroundColor: colors.scrim,
          }}
        >
          <View
            style={{
              width: `${Math.min(1, progress) * 100}%`,
              height: "100%",
              backgroundColor: colors.brand,
            }}
          />
        </View>
      )}
      {badge === undefined ? null : (
        <View
          style={{
            position: "absolute",
            top: 0.5 * em,
            left: 0.5 * em,
            borderRadius: 0.4 * em,
            backgroundColor: colors.scrim,
          }}
        >
          {badge}
        </View>
      )}
    </View>
  );
};
