import type { ReactNode } from "react";
import { View } from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import { useTheme } from "../theme/theme.ts";
import { scrubFraction } from "./controls.ts";

/**
 * What a finger does on the phone's timeline, as in every phone player: drag the playhead (the
 * picture keeps playing where it was until the finger lifts, then seeks there) or tap a spot
 * to jump to it. The touch area is taller than the thin bar without taking more room.
 * Positions are fractions of the bar, 0 to 1.
 */
export const PhoneScrub = ({
  width,
  onDrag,
  onSeek,
  children,
}: {
  readonly width: number;
  /** The finger's spot while it drags, `undefined` once it lifts or the drag is cancelled. */
  readonly onDrag: (fraction: number | undefined) => void;
  readonly onSeek: (fraction: number) => void;
  readonly children: ReactNode;
}) => {
  const { em } = useTheme();
  const pan = usePanGesture({
    runOnJS: true,
    // Sideways only: a vertical swipe stays the picture's.
    activeOffsetX: [-4, 4],
    failOffsetY: [-24, 24],
    onActivate: (event) => onDrag(scrubFraction(event.x, width)),
    onUpdate: (event) => onDrag(scrubFraction(event.x, width)),
    onDeactivate: (event) => {
      if (!event.canceled) onSeek(scrubFraction(event.x, width));
    },
    onFinalize: () => onDrag(undefined),
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (event) => onSeek(scrubFraction(event.x, width)),
  });
  const gesture = useExclusiveGestures(pan, tap);
  const reach = 0.9 * em;
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={{ paddingVertical: reach, marginVertical: -reach }}>
        {children}
      </View>
    </GestureDetector>
  );
};
