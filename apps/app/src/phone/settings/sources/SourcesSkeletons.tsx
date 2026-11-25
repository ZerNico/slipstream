import { View } from "react-native";
import { useTheme } from "../../../theme/theme.ts";
import { Bone, Skeleton } from "../../../ui/Skeleton.tsx";
import { CHANNEL_LOGO_EM, CHANNEL_ROW_EM } from "./metrics.ts";

/** The sources page while it loads: one source card and the Channels row, in their measures. */
export const SourcesSkeleton = () => {
  const { em, radii } = useTheme();
  return (
    <Skeleton>
      <View style={{ paddingTop: 1.3 * em, gap: 0.5 * em }}>
        <View style={{ paddingHorizontal: em, paddingBottom: 0.3 * em }}>
          <Bone width={6 * em} height={1.05 * em} />
        </View>
        <View style={{ marginHorizontal: em }}>
          <Bone width="100%" height={8.4 * em} radius={radii.rL} />
        </View>
        <View style={{ paddingHorizontal: em, paddingTop: 1.3 * em, paddingBottom: 0.3 * em }}>
          <Bone width={6 * em} height={1.05 * em} />
        </View>
        <View style={{ marginHorizontal: em }}>
          <Bone width="100%" height={3.1 * em} radius={radii.rL} />
        </View>
      </View>
    </Skeleton>
  );
};

/** A form page while what it edits loads: labelled fields in the loaded measures. */
export const FormSkeleton = ({ fields }: { readonly fields: number }) => {
  const { em } = useTheme();
  return (
    <Skeleton>
      <View style={{ padding: em, gap: 0.35 * em }}>
        {Array.from({ length: fields }, (_, field) => field).map((field) => (
          <View key={field} style={{ gap: 0.35 * em, paddingBottom: 1.2 * em }}>
            <Bone width={7 * em} height={0.88 * em} />
            <Bone width="100%" height={2.6 * em} radius={0.6 * em} />
          </View>
        ))}
      </View>
    </Skeleton>
  );
};

/** The channel list while it loads: rows of number, logo and name at the loaded height. */
export const ChannelsSkeleton = ({ rows = 10 }: { readonly rows?: number }) => {
  const { em, radii } = useTheme();
  return (
    <Skeleton>
      {Array.from({ length: rows }, (_, row) => row).map((row) => (
        <View
          key={row}
          style={{
            height: CHANNEL_ROW_EM * em,
            flexDirection: "row",
            alignItems: "center",
            gap: 0.7 * em,
            paddingHorizontal: em,
          }}
        >
          <Bone width={1.8 * em} height={0.9 * em} />
          <Bone
            width={CHANNEL_LOGO_EM * 1.6 * em}
            height={CHANNEL_LOGO_EM * em}
            radius={radii.rM}
          />
          <Bone width={row % 2 === 0 ? "45%" : "35%"} height={0.95 * em} />
        </View>
      ))}
    </Skeleton>
  );
};
