import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme.ts";
import { BrandMark } from "../ui/BrandMark.tsx";
import { Bone, Skeleton } from "../ui/Skeleton.tsx";

/*
 * The phone screens while they load, each in the loaded screen's shapes and measures, so what
 * arrives lands where its block was and nothing moves.
 */

/**
 * Rows of a list page: a picture and two lines each (a place, Scheduled, Problems, Series).
 * `title` adds the page's big title and its quiet line on top (a place, a series recording).
 */
export const ListSkeleton = ({
  rows = 6,
  title = false,
}: {
  readonly rows?: number;
  readonly title?: boolean;
}) => {
  const { em, radii } = useTheme();
  return (
    <Skeleton>
      {title ? (
        <View style={{ paddingHorizontal: em, gap: 0.5 * em, paddingBottom: 0.6 * em }}>
          <Bone width="65%" height={1.7 * em} />
          <Bone width="35%" height={0.88 * em} />
        </View>
      ) : null}
      {Array.from({ length: rows }, (_, row) => row).map((row) => (
        <View
          key={row}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 0.8 * em,
            paddingHorizontal: em,
            paddingVertical: 0.5 * em,
          }}
        >
          <Bone width={8 * em} height={4.5 * em} radius={radii.rM} />
          <View style={{ flex: 1, gap: 0.5 * em }}>
            <Bone width={row % 2 === 0 ? "80%" : "65%"} height={0.95 * em} />
            <Bone width="45%" height={0.8 * em} />
          </View>
        </View>
      ))}
    </Skeleton>
  );
};

/** Home: the mark, the picture of what records, its lines and buttons, a row to continue. */
export const HomeSkeleton = () => {
  const { colors, em, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const side = 1.1 * em;
  const thumb = 13 * em;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 0.8 * em }}>
      <View style={{ paddingHorizontal: side, paddingBottom: 1.6 * em }}>
        <BrandMark size={2 * em} />
      </View>
      <Skeleton>
        <View style={{ paddingHorizontal: side, gap: 0.8 * em }}>
          <Bone width={width - 2 * side} height={((width - 2 * side) * 9) / 16} radius={radii.rL} />
          <Bone width="35%" height={0.9 * em} />
          <Bone width="85%" height={2 * em} />
          <Bone width="45%" height={0.9 * em} />
          <View style={{ flexDirection: "row", gap: 0.6 * em }}>
            <Bone width={9 * em} height={2.8 * em} radius={radii.rM} />
            <Bone width={9 * em} height={2.8 * em} radius={radii.rM} />
          </View>
        </View>
        <View style={{ paddingTop: 1.6 * em, gap: 0.7 * em }}>
          <View style={{ paddingHorizontal: side }}>
            <Bone width={10 * em} height={1.1 * em} />
          </View>
          <View style={{ flexDirection: "row", gap: 0.8 * em, paddingHorizontal: side }}>
            {[0, 1].map((index) => (
              <View key={index} style={{ gap: 0.4 * em }}>
                <Bone width={thumb} height={(thumb * 9) / 16} radius={radii.rM} />
                <Bone width={thumb * 0.8} height={0.9 * em} />
              </View>
            ))}
          </View>
        </View>
      </Skeleton>
    </View>
  );
};

/** The library: links, then the places as a two-column grid of pictures. */
export const LibrarySkeleton = () => {
  const { em, radii } = useTheme();
  const { width } = useWindowDimensions();
  const tile = (width - 2 * em - 0.8 * em) / 2;
  return (
    <Skeleton>
      <View style={{ paddingHorizontal: em, gap: 1.1 * em }}>
        <Bone width="100%" height={9 * em} radius={radii.rL} />
        <Bone width={9 * em} height={1.1 * em} />
        {[0, 1].map((row) => (
          <View key={row} style={{ flexDirection: "row", gap: 0.8 * em }}>
            {[0, 1].map((column) => (
              <View key={column} style={{ gap: 0.4 * em }}>
                <Bone width={tile} height={(tile * 9) / 16} radius={radii.rM} />
                <Bone width={tile * 0.7} height={0.9 * em} />
                <Bone width={tile * 0.45} height={0.8 * em} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </Skeleton>
  );
};

/** A recording's page: its picture across the top, the title and the lines under it. */
export const DetailSkeleton = () => {
  const { colors, em } = useTheme();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Skeleton>
        <Bone width={width} height={(width * 9) / 16} radius={0} />
        <View style={{ padding: 1.1 * em, gap: 0.6 * em }}>
          <Bone width="80%" height={1.65 * em} />
          <Bone width="60%" height={0.9 * em} />
          <Bone width="100%" height={3 * em} />
        </View>
      </Skeleton>
    </View>
  );
};
