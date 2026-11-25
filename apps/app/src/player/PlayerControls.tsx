import { formatters, m } from "@slipstream/i18n";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { Chip } from "../ui/Chip.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { SKIP_FORWARD_SECONDS, SKIP_SECONDS } from "./controls.ts";

/**
 * The overlay's top line: Back (phone), the recording chip, the title, picture-in-picture
 * (phone) and the clock.
 */
export const TopBar = ({
  title,
  recordingNow,
  now,
  size,
  pad,
  onBack,
  onPictureInPicture,
}: {
  readonly title: string;
  readonly recordingNow: boolean;
  readonly now: number;
  readonly size: number;
  readonly pad: number;
  readonly onBack: () => void;
  readonly onPictureInPicture?: (() => void) | undefined;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        left: pad,
        right: pad,
        top: (isTV ? 2.2 : 1) * em,
        flexDirection: "row",
        alignItems: "center",
        gap: 0.9 * em,
      }}
    >
      {isTV ? null : (
        <FocusButton
          label={m.action_back()}
          icon="chevronLeft"
          iconOnly
          variant="ghost"
          size={size}
          onPress={onBack}
        />
      )}
      {recordingNow ? <Chip label={m.status_recording()} tone="rec" size={0.85 * size} /> : null}
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.45 * size * em,
          color: colors.fg,
        }}
      >
        {title}
      </Text>
      {onPictureInPicture === undefined ? null : (
        <FocusButton
          label={m.player_picture_in_picture()}
          icon="pip"
          iconOnly
          variant="ghost"
          size={size}
          onPress={onPictureInPicture}
        />
      )}
      <Text
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: 1.3 * size * em,
          color: colors.fg,
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatters().time(new Date(now))}
      </Text>
    </View>
  );
};

/** The Record control in the row: record the programme at the playhead, or it records. */
export interface RecordButton {
  readonly kind: "record" | "recording";
  readonly busy: boolean;
  /** Record: records at once. Recording: opens Extend and Stop. */
  readonly onPress: () => void;
  /** The full record options (the record sheet). */
  readonly onLongPress: (() => void) | undefined;
}

/**
 * The controls row: the transport from the left, play a size larger; what needs a word (live,
 * speed, Record) and the options after a gap. Amber is the focus alone; red says it records.
 */
export const ControlsRow = ({
  size,
  paused,
  speed,
  showLive,
  record,
  track,
  playFocus,
  optionsFocus,
  onFromStart,
  onSkip,
  onTogglePause,
  onLive,
  onNextTrack,
  onOptions,
}: {
  readonly size: number;
  readonly paused: boolean;
  readonly speed: number;
  readonly showLive: boolean;
  /** Absent for a profile that may not record, or where there is nothing to record. */
  readonly record: RecordButton | undefined;
  /** The audio track's name, when there are tracks to switch between. */
  readonly track: string | undefined;
  readonly playFocus: boolean;
  readonly optionsFocus: boolean;
  readonly onFromStart: () => void;
  readonly onSkip: (seconds: number) => void;
  readonly onTogglePause: () => void;
  readonly onLive: () => void;
  readonly onNextTrack: () => void;
  readonly onOptions: () => void;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0.7 * em }}>
      <FocusButton
        label={m.player_from_start()}
        icon="start"
        iconOnly
        size={size}
        onPress={onFromStart}
      />
      <FocusButton
        label={m.player_skip_back({ seconds: SKIP_SECONDS })}
        icon="back"
        iconOnly
        size={size}
        onPress={() => onSkip(-SKIP_SECONDS)}
      />
      <FocusButton
        label={paused ? m.player_play() : m.player_pause()}
        icon={paused ? "play" : "pause"}
        iconOnly
        // Not amber at rest: amber means focus everywhere, so it never doubles for it.
        preferredFocus={playFocus}
        size={1.2 * size}
        onPress={onTogglePause}
      />
      <FocusButton
        label={m.player_skip_forward({ seconds: SKIP_FORWARD_SECONDS })}
        icon="fwd"
        iconOnly
        size={size}
        onPress={() => onSkip(SKIP_FORWARD_SECONDS)}
      />
      <View style={{ flex: 1 }} />
      {speed === 1 ? null : (
        // Only a word while it is not 1×; the speed itself is set in Options.
        <Text
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: size * em,
            color: colors.fg2,
            fontVariant: ["tabular-nums"],
            paddingHorizontal: 0.4 * em,
          }}
        >
          {m.player_speed_value({ speed })}
        </Text>
      )}
      {showLive ? (
        <FocusButton label={m.player_watch_live()} icon="live" size={size} onPress={onLive} />
      ) : null}
      {record === undefined ? null : (
        <FocusButton
          label={record.kind === "recording" ? m.player_badge_recording() : m.record_now_action()}
          icon="rec"
          // The phone's compact row keeps it a round button; the TV says it.
          iconOnly={!isTV}
          tone={record.kind === "recording" ? "live" : undefined}
          disabled={record.busy}
          size={size}
          onPress={record.onPress}
          onLongPress={record.onLongPress}
        />
      )}
      {track === undefined ? null : (
        <FocusButton label={track} icon="audio" iconOnly size={size} onPress={onNextTrack} />
      )}
      <FocusButton
        label={m.action_options()}
        icon="settings"
        iconOnly
        size={size}
        preferredFocus={optionsFocus}
        onPress={onOptions}
      />
    </View>
  );
};
