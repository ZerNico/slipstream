import { type FitMode, fitAfterPinch, holdSpeed } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useEffect, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  GestureDetector,
  useCompetingGestures,
  useExclusiveGestures,
  useLongPressGesture,
  usePinchGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import { useTheme } from "../theme/theme.ts";
import { Icon } from "../ui/Icon.tsx";
import { addSkip, SKIP_SECONDS, type SkipRun, tapSide } from "./controls.ts";

/** How long the Fit or Fill word stays after a pinch. */
const FIT_HINT_MS = 1400;

/**
 * The phone player's picture under its controls, and what a finger does on it (as phone video
 * players do): a tap shows or hides the controls; a double tap on the left or right skips 10 s
 * that way, and every further tap on that side while its "−20 s" shows adds 10 s more; holding
 * plays at {@link holdSpeed} until the finger lifts; pinching out fills the screen and pinching
 * in fits the whole picture.
 */
export const PictureGestures = ({
  fit,
  holding,
  onToggleControls,
  onSkip,
  onHold,
  onFit,
}: {
  readonly fit: FitMode;
  /** Whether the hold is playing fast now (the player ends it at live). */
  readonly holding: boolean;
  readonly onToggleControls: () => void;
  readonly onSkip: (seconds: number) => void;
  readonly onHold: (down: boolean) => void;
  readonly onFit: (fit: FitMode) => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const { width } = useWindowDimensions();
  const [run, setRun] = useState<SkipRun | undefined>(undefined);
  const [fitHint, setFitHint] = useState<FitMode | undefined>(undefined);

  useEffect(() => {
    if (run === undefined) return;
    const timer = setTimeout(() => setRun(undefined), Math.max(0, run.until - Date.now()));
    return () => clearTimeout(timer);
  }, [run]);
  useEffect(() => {
    if (fitHint === undefined) return;
    const timer = setTimeout(() => setFitHint(undefined), FIT_HINT_MS);
    return () => clearTimeout(timer);
  }, [fitHint]);

  const skip = (direction: -1 | 1) => {
    setRun((current) => addSkip(current, direction, Date.now()));
    onSkip(direction * SKIP_SECONDS);
  };

  const doubleTap = useTapGesture({
    runOnJS: true,
    numberOfTaps: 2,
    maxDelay: 250,
    onActivate: (event) => {
      const side = tapSide(event.x, width);
      if (side === undefined) onToggleControls();
      else skip(side);
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (event) => {
      // While a run's hint shows, a single tap on its side adds to it.
      const side = tapSide(event.x, width);
      if (run !== undefined && side === run.direction && Date.now() < run.until) skip(side);
      else onToggleControls();
    },
  });
  const hold = useLongPressGesture({
    runOnJS: true,
    minDuration: 450,
    onActivate: () => onHold(true),
    onFinalize: () => onHold(false),
  });
  const pinch = usePinchGesture({
    runOnJS: true,
    onDeactivate: (event) => {
      const next = fitAfterPinch(fit, event.scale);
      if (next === fit) return;
      onFit(next);
      setFitHint(next);
    },
  });
  const taps = useExclusiveGestures(doubleTap, tap);
  const gesture = useCompetingGestures(pinch, hold, taps);

  const hint = (text: string) => (
    <Text
      style={{
        fontFamily: fonts.fUiSemiBold,
        fontSize: 1.1 * em,
        color: colors.fg,
        fontVariant: ["tabular-nums"],
      }}
    >
      {text}
    </Text>
  );
  const bubble = {
    paddingHorizontal: em,
    paddingVertical: 0.5 * em,
    borderRadius: 2 * em,
    backgroundColor: colors.media,
  } as const;

  return (
    <>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>
      {run === undefined ? null : (
        <View
          pointerEvents="none"
          style={[
            styles.side,
            run.direction === -1 ? { left: 0 } : { right: 0 },
            { width: 0.4 * width },
          ]}
        >
          <View style={bubble}>
            {hint(
              run.direction === -1
                ? m.player_osd_skip_back({ seconds: run.seconds })
                : m.player_osd_skip_forward({ seconds: run.seconds }),
            )}
          </View>
        </View>
      )}
      {holding ? <HoldPill /> : null}
      {fitHint === undefined ? null : (
        <View pointerEvents="none" style={styles.center}>
          <View style={bubble}>
            {hint(fitHint === "fit" ? m.player_osd_fit() : m.player_osd_fill())}
          </View>
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  side: { position: "absolute", top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  top: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * What holding shows (as YouTube does): a small "2× ▸▸" pill at the top edge, fading in, its
 * arrows breathing while the finger stays down.
 */
const HoldPill = () => {
  const { colors, em, fonts, motion } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(0.45, { duration: 600 }), -1, true);
  }, [pulse, reduced]);
  const arrows = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View pointerEvents="none" style={[styles.top, { top: 0.9 * em }]}>
      <Animated.View
        entering={FadeIn.duration(motion.tFocus)}
        exiting={FadeOut.duration(motion.tFocus)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 0.3 * em,
          paddingHorizontal: 0.8 * em,
          paddingVertical: 0.3 * em,
          borderRadius: 2 * em,
          backgroundColor: colors.media,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 0.9 * em,
            color: colors.fg,
            fontVariant: ["tabular-nums"],
          }}
        >
          {m.player_speed_value({ speed: holdSpeed })}
        </Text>
        <Animated.View style={arrows}>
          <Icon name="fwd" size={1.05 * em} color={colors.fg} />
        </Animated.View>
      </Animated.View>
    </View>
  );
};
