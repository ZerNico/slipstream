import { createContext, type ReactNode, use, useEffect } from "react";
import { type DimensionValue, View, type ViewStyle } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../theme/theme.ts";

/** The breath every block of one skeleton shares, so they pulse together. */
const Pulse = createContext<SharedValue<number> | undefined>(undefined);

/**
 * A screen's skeleton: the loaded screen's shapes in a quiet tone, breathing together (still
 * with reduced motion), so the content arrives in place and nothing moves. Wrap the blocks.
 */
export const Skeleton = ({ children }: { readonly children: ReactNode }) => {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(0.55, { duration: 900 }), -1, true);
  }, [pulse, reduced]);
  return (
    <Pulse value={pulse}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </Pulse>
  );
};

/** One block of a skeleton: a rounded shape where a picture, a title or a line will be. */
export const Bone = ({
  width,
  height,
  radius,
  style,
}: {
  readonly width: DimensionValue;
  readonly height: DimensionValue;
  readonly radius?: number;
  readonly style?: ViewStyle;
}) => {
  const { colors, radii } = useTheme();
  const pulse = use(Pulse);
  const breathing = useAnimatedStyle(() => ({ opacity: pulse?.value ?? 1 }));
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius ?? radii.rS, backgroundColor: colors.surface },
        breathing,
        style,
      ]}
    />
  );
};
