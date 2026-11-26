import { m } from "@slipstream/i18n";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { FocusButton } from "../ui/FocusButton.tsx";
import { Bone, Skeleton } from "../ui/Skeleton.tsx";
import { StatusScreen } from "../ui/StatusScreen.tsx";
import { Rail, type RailItem } from "./Rail.tsx";
import { CARD_EM, CARD_LIFT_ROOM, RAIL_COLLAPSED_EM } from "./rail-metrics.ts";

/**
 * A TV screen that says one thing (not found, what went wrong) with the rail beside it, so Left
 * still leads elsewhere; with `onRetry`, Try again has focus.
 */
export const TvStatus = ({
  current,
  title,
  onRetry,
}: {
  readonly current: RailItem;
  readonly title: string;
  readonly onRetry?: (() => void) | undefined;
}) => (
  <>
    <StatusScreen
      title={title}
      actions={
        onRetry === undefined ? undefined : (
          <FocusButton label={m.action_try_again()} preferredFocus onPress={onRetry} />
        )
      }
    />
    <Rail current={current} />
  </>
);

/** A screen's heading as every TV screen sets it: large, upper case, in the display face. */
export const TvTitle = ({ children }: { readonly children: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      numberOfLines={1}
      style={{ flexShrink: 1, fontFamily: fonts.fDisplay, fontSize: 3.4 * em, color: colors.fg }}
    >
      {children.toUpperCase()}
    </Text>
  );
};

/** A row of card shapes in a row's place, with the room a focused card lifts into. */
export const CardRowBones = ({ heading = true }: { readonly heading?: boolean }) => {
  const { em } = useTheme();
  return (
    <View style={{ gap: 0.4 * em }}>
      {heading ? (
        <Bone width={12 * em} height={1.25 * em} style={{ marginLeft: CARD_LIFT_ROOM * em }} />
      ) : null}
      <View style={{ flexDirection: "row", gap: 1.4 * em, padding: CARD_LIFT_ROOM * em }}>
        {[0, 1, 2, 3, 4].map((card) => (
          <View key={card} style={{ width: CARD_EM * em, gap: 0.55 * em }}>
            <Bone width={CARD_EM * em} height={(CARD_EM * em * 9) / 16} radius={0.7 * em} />
            <Bone width="75%" height={1.1 * em} />
            <Bone width="50%" height={em} />
          </View>
        ))}
      </View>
    </View>
  );
};

/**
 * A TV screen while its data loads, in the loaded screen's frame: the rail, the heading when the
 * screen has a fixed one, and `children` (bones) where the content will be. With `fullScreen`
 * the bones own the whole screen and place themselves, as the guide does (its rail shows only
 * after Back).
 */
export const TvSkeleton = ({
  current,
  title,
  fullScreen = false,
  children,
}: {
  readonly current: RailItem;
  readonly title?: string | undefined;
  readonly fullScreen?: boolean;
  readonly children: ReactNode;
}) => {
  const { colors, em } = useTheme();
  if (fullScreen) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
        {/* The bones place themselves in the screen's frame, not in a wrapper of no height. */}
        <Skeleton style={StyleSheet.absoluteFill}>{children}</Skeleton>
      </View>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Rail current={current} />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            paddingLeft: (RAIL_COLLAPSED_EM + 3 - CARD_LIFT_ROOM) * em,
            paddingRight: 4 * em,
            paddingTop: 2.7 * em,
            gap: 2 * em,
          },
        ]}
      >
        {title === undefined ? null : (
          <View style={{ paddingLeft: CARD_LIFT_ROOM * em }}>
            <TvTitle>{title}</TvTitle>
          </View>
        )}
        <Skeleton>
          <View style={{ gap: 1.6 * em }}>{children}</View>
        </Skeleton>
      </View>
    </View>
  );
};

/** List rows' shapes (Scheduled, Problems, Series recordings) under a screen's heading. */
export const ListBones = ({ rows = 5 }: { readonly rows?: number }) => {
  const { em, radii } = useTheme();
  return (
    <View style={{ gap: 0.7 * em, paddingLeft: CARD_LIFT_ROOM * em, maxWidth: 70 * em }}>
      {Array.from({ length: rows }, (_, row) => (
        <Bone key={row} width="100%" height={4.2 * em} radius={radii.rM} />
      ))}
    </View>
  );
};
