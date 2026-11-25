import { StyleSheet, View } from "react-native";
import { useTheme } from "../theme/theme.ts";

/** Share of the bar (0 to 1) for each timeline mark. */
export interface TimelineMarks {
  /** How far the captured data reaches (the live edge). */
  readonly captured: number;
  /** How far playback has got, when something is playing. */
  readonly played?: number | undefined;
  /** Where the scrub preview sits while the timeline is focused. */
  readonly preview?: number | undefined;
  /** Programme start and end ticks. */
  readonly ticks: readonly number[];
}

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * The capture timeline from the design doc (`.tl`): captured range, played range, programme
 * ticks, the amber playhead and the live edge dot. `focused` grows the bar and rings it, the
 * timeline-focused player state. `width` is in dp.
 */
export const CaptureTimeline = ({
  marks,
  width,
  focused = false,
}: {
  readonly marks: TimelineMarks;
  readonly width: number;
  readonly focused?: boolean;
}) => {
  const { colors, tokens, em } = useTheme();
  const timeline = tokens.components.timeline;
  const height = (focused ? 0.9 : 0.6) * em;
  const edge = 0.95 * em;
  const captured = clamp(marks.captured);
  const head = marks.preview ?? marks.played;
  return (
    <View
      style={{
        width,
        height,
        justifyContent: "center",
        borderRadius: height,
        borderWidth: focused ? 2 : 0,
        borderColor: colors.brand,
      }}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: timeline.track, borderRadius: height / 2 },
        ]}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: width * captured,
          backgroundColor: timeline.captured,
          borderTopLeftRadius: height / 2,
          borderBottomLeftRadius: height / 2,
        }}
      />
      {marks.played === undefined ? null : (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: width * clamp(marks.played),
            backgroundColor: timeline.played,
            borderTopLeftRadius: height / 2,
            borderBottomLeftRadius: height / 2,
          }}
        />
      )}
      {marks.ticks.map((tick) => (
        <View
          key={tick}
          style={{
            position: "absolute",
            left: width * clamp(tick) - 1,
            top: -0.45 * em,
            bottom: -0.45 * em,
            width: 2,
            backgroundColor: colors.fg2,
          }}
        />
      ))}
      <View
        style={{
          position: "absolute",
          left: width * captured - edge / 2,
          width: edge,
          height: edge,
          borderRadius: edge / 2,
          backgroundColor: timeline.live,
        }}
      />
      {head === undefined ? null : (
        <View
          style={{
            position: "absolute",
            left: width * clamp(head) - 0.15 * em,
            top: -0.5 * em,
            bottom: -0.5 * em,
            width: 0.3 * em,
            borderRadius: 0.15 * em,
            backgroundColor: timeline.playhead,
          }}
        />
      )}
    </View>
  );
};
