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
 * ticks, and the amber playhead knob. Live state is the read-out's and the Watch live button's, not a dot. `focused` grows the bar and rings it in
 * the focus colour, the TV player's timeline-focused state. `focusable` keeps the room the
 * focused bar and its ring take, so focus coming and going never moves what is around it.
 * `width` is in dp.
 */
export const CaptureTimeline = ({
  marks,
  width,
  focused = false,
  focusable = false,
  grabbed = false,
}: {
  readonly marks: TimelineMarks;
  readonly width: number;
  readonly focused?: boolean;
  readonly focusable?: boolean;
  /** A finger is dragging the playhead (phone): the knob grows, as the web's does. */
  readonly grabbed?: boolean;
}) => {
  const { colors, tokens, em } = useTheme();
  const timeline = tokens.components.timeline;
  const rest = 0.6 * em;
  const grown = 0.9 * em;
  const height = focused ? grown : rest;
  // The ring sits a little off the bar, as the design doc's focus ring does around a card.
  const ringGap = 0.3 * em;
  const ringWidth = Math.max(2, 0.12 * em);
  const box = focusable ? grown + 2 * (ringGap + ringWidth) : height;
  const radius = height / 2;
  const captured = clamp(marks.captured);
  const head = marks.preview ?? marks.played;
  // The playhead is a round knob, as on the web's timeline (`.tl-knob`); bigger while dragged or
  // focused.
  const knob = (focused || grabbed ? 1.3 : 1.0) * em;
  return (
    <View style={{ width, height: box, justifyContent: "center" }}>
      <View style={{ width, height }}>
        {focused ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: -(ringGap + ringWidth),
              right: -(ringGap + ringWidth),
              top: -(ringGap + ringWidth),
              bottom: -(ringGap + ringWidth),
              borderRadius: radius + ringGap + ringWidth,
              borderWidth: ringWidth,
              borderColor: colors.focusRing,
            }}
          />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: timeline.track, borderRadius: radius },
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
            borderTopLeftRadius: radius,
            borderBottomLeftRadius: radius,
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
              borderTopLeftRadius: radius,
              borderBottomLeftRadius: radius,
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
        {head === undefined ? null : (
          <View
            style={{
              position: "absolute",
              left: width * clamp(head) - knob / 2,
              top: (height - knob) / 2,
              width: knob,
              height: knob,
              borderRadius: knob / 2,
              backgroundColor: timeline.playhead,
              boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: colors.scrim }],
            }}
          />
        )}
      </View>
    </View>
  );
};
