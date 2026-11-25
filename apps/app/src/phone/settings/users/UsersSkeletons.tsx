import { View } from "react-native";
import { useTheme } from "../../../theme/theme.ts";
import { Bone, Skeleton } from "../../../ui/Skeleton.tsx";

/** A heading's bone, where a panel heading will be. */
const HeadingBone = ({ width }: { readonly width: number }) => {
  const { em } = useTheme();
  return (
    <View
      style={{
        minHeight: 2.6 * em,
        justifyContent: "flex-end",
        paddingHorizontal: em,
        paddingTop: 1.1 * em,
        paddingBottom: 0.3 * em,
      }}
    >
      <Bone width={width * em} height={1.05 * em} />
    </View>
  );
};

/** A panel of person rows: a round avatar and two lines each. */
const PeopleBones = ({ rows }: { readonly rows: number }) => {
  const { colors, em, radii } = useTheme();
  return (
    <View
      style={{
        marginHorizontal: em,
        borderRadius: radii.rL,
        borderWidth: 1,
        borderColor: colors.surface,
      }}
    >
      {Array.from({ length: rows }, (_, row) => row).map((row) => (
        <View
          key={row}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 0.9 * em,
            paddingHorizontal: em,
            paddingVertical: 0.8 * em,
            minHeight: 3.2 * em,
          }}
        >
          <Bone width={2.6 * em} height={2.6 * em} radius={1.3 * em} />
          <View style={{ flex: 1, gap: 0.45 * em }}>
            <Bone width={row % 2 === 0 ? "45%" : "38%"} height={0.95 * em} />
            <Bone width={row % 2 === 0 ? "70%" : "60%"} height={0.8 * em} />
          </View>
        </View>
      ))}
    </View>
  );
};

/**
 * Users & devices while it loads: the profiles' heading and rows (with Add profile), then the
 * guests' heading and a row, in the loaded page's measures.
 */
export const UsersSkeleton = ({ profiles }: { readonly profiles: number }) => (
  <Skeleton>
    <HeadingBone width={9} />
    <PeopleBones rows={profiles + 1} />
    <HeadingBone width={5} />
    <PeopleBones rows={1} />
  </Skeleton>
);

/** A profile or invite form while it loads: name, picture, then a panel. */
export const FormSkeleton = () => {
  const { em, radii } = useTheme();
  return (
    <Skeleton>
      <View style={{ paddingHorizontal: em, paddingTop: 0.6 * em, gap: 0.6 * em }}>
        <Bone width={4 * em} height={0.9 * em} />
        <Bone width="100%" height={2.9 * em} radius={radii.rM} />
        <View style={{ height: 0.9 * em }} />
        <Bone width={4.5 * em} height={0.9 * em} />
        <View style={{ flexDirection: "row", gap: 0.5 * em, alignItems: "center" }}>
          {Array.from({ length: 7 }, (_, index) => index).map((index) => (
            <Bone
              key={index}
              width={(index === 0 ? 3.2 : 2.8) * em}
              height={(index === 0 ? 3.2 : 2.8) * em}
              radius={1.6 * em}
            />
          ))}
        </View>
      </View>
      <HeadingBone width={3} />
      <View style={{ paddingHorizontal: em }}>
        <Bone width="100%" height={3.2 * em} radius={radii.rL} />
      </View>
    </Skeleton>
  );
};
