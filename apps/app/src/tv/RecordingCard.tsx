import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import type { ArtworkSubject } from "../data/artwork.ts";
import { useTheme } from "../theme/theme.ts";
import { Artwork } from "../ui/Artwork.tsx";
import { CARD_EM } from "./rail-metrics.ts";

/** Props for {@link RecordingCard}. */
export interface RecordingCardProps {
  /** What the thumbnail shows: its picture, else its channel. */
  readonly subject: ArtworkSubject;
  /** The line below the thumbnail. */
  readonly title: string;
  /** The quiet line below the title ("45 min left · Sa 21. Nov"). */
  readonly meta: string;
  /** Watched share, 0 to 1; no bar at 0. */
  readonly progress: number;
  /** A chip in the thumbnail's top right corner (REC, Watched). */
  readonly badge?: ReactNode;
  readonly preferredFocus?: boolean;
  /** Hears focus arrive, so the screen's backdrop can follow it. */
  readonly onFocus?: () => void;
  readonly onPress: () => void;
  /** A long press of OK: a shortcut, such as playing without opening the page. */
  readonly onLongPress?: (() => void) | undefined;
  /** Quiet until focused: something scheduled, not there yet. */
  readonly dim?: boolean;
}

/**
 * A TV recording card (`.card`): a 16:9 picture (guide image, TMDB, a frame from the recording,
 * else its channel), an inset watched bar, the title and a quiet line below; on focus it lifts
 * and rings in amber, the only amber thing on screen. Rows give it room to lift
 * (`CARD_LIFT_ROOM` in rail-metrics.ts), so the ring is never cut.
 */
export const RecordingCard = ({
  subject,
  title,
  meta,
  progress,
  badge,
  preferredFocus = false,
  onFocus,
  onPress,
  onLongPress,
  dim = false,
}: RecordingCardProps) => {
  const { colors, em, fonts, motion } = useTheme();
  const [focused, setFocused] = useState(false);
  const lift = useDerivedValue(() =>
    withTiming(focused ? 1 : 0, {
      duration: motion.tFocus,
      easing: Easing.bezier(...motion.easing),
    }),
  );
  const scale = motion.cardFocusScale;
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lift.value * (scale - 1) }],
  }));
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      style={{ width: CARD_EM * em, gap: 0.55 * em, opacity: dim && !focused ? 0.6 : 1 }}
    >
      <Animated.View
        style={[
          {
            aspectRatio: 16 / 9,
            borderRadius: 0.7 * em,
            backgroundColor: colors.raised,
            overflow: "hidden",
            borderWidth: 0.17 * em,
            borderColor: focused ? colors.brand : "transparent",
          },
          thumbStyle,
        ]}
      >
        <Artwork subject={subject} logoHeight={3 * em} />
        {badge === undefined ? null : (
          <View style={[styles.absolute, { right: 0.6 * em, top: 0.6 * em }]}>{badge}</View>
        )}
        {progress <= 0 ? null : (
          <View
            style={[
              styles.progressTrack,
              {
                left: 0.8 * em,
                right: 0.8 * em,
                bottom: 0.7 * em,
                height: 0.3 * em,
                borderRadius: 0.3 * em,
                backgroundColor: colors.scrim,
              },
            ]}
          >
            <View
              style={{
                width: `${Math.min(1, progress) * 100}%`,
                height: "100%",
                borderRadius: 0.3 * em,
                backgroundColor: colors.brand,
              }}
            />
          </View>
        )}
      </Animated.View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.1 * em,
          color: focused ? colors.fg : colors.fg2,
        }}
      >
        {title}
      </Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg3 }}>
        {meta}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  absolute: { position: "absolute" },
  progressTrack: { position: "absolute", overflow: "hidden" },
});
