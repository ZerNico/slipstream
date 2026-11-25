import { m } from "@slipstream/i18n";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../../theme/theme.ts";
import { Icon } from "../../ui/Icon.tsx";
import { CARD_EM } from "../rail-metrics.ts";

/**
 * The card at a shelf's end that opens the whole place (Plex's "See all"): a card's frame with
 * the series glyph and "See all" on it, the place's name and its count below. It lifts and rings
 * in amber on focus, as a recording card does.
 */
export const PlaceCard = ({
  name,
  count,
  preferredFocus = false,
  onPress,
}: {
  readonly name: string;
  readonly count: number;
  readonly preferredFocus?: boolean;
  readonly onPress: () => void;
}) => {
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
  const countText = m.library_tile_count({ count });
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={`${m.action_see_all()}, ${name}, ${countText}`}
      style={{ width: CARD_EM * em, gap: 0.55 * em }}
    >
      <Animated.View
        style={[
          {
            aspectRatio: 16 / 9,
            borderRadius: 0.7 * em,
            backgroundColor: colors.surface,
            borderWidth: 0.17 * em,
            borderColor: focused ? colors.brand : "transparent",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.6 * em,
          },
          thumbStyle,
        ]}
      >
        <Icon name="series" size={2.4 * em} color={focused ? colors.fg : colors.fg2} />
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.2 * em,
            color: focused ? colors.fg : colors.fg2,
          }}
        >
          {m.action_see_all()}
        </Text>
      </Animated.View>
      <View style={{ gap: 0.55 * em }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.1 * em,
            color: focused ? colors.fg : colors.fg2,
          }}
        >
          {name}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.fUi, fontSize: em, color: colors.fg3 }}>
          {countText}
        </Text>
      </View>
    </Pressable>
  );
};
