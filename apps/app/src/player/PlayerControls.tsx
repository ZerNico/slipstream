import { extendStepMinutes } from "@slipstream/domain";
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

/**
 * The controls row: the transport from the left, play a size larger; what needs a word (live,
 * speed, extend) and the options after a gap. Amber is the focus alone.
 */
export const ControlsRow = ({
  size,
  paused,
  speed,
  showLive,
  showExtend,
  track,
  playFocus,
  optionsFocus,
  onFromStart,
  onSkip,
  onTogglePause,
  onLive,
  onExtend,
  onNextTrack,
  onOptions,
}: {
  readonly size: number;
  readonly paused: boolean;
  readonly speed: number;
  readonly showLive: boolean;
  readonly showExtend: boolean;
  /** The audio track's name, when there are tracks to switch between. */
  readonly track: string | undefined;
  readonly playFocus: boolean;
  readonly optionsFocus: boolean;
  readonly onFromStart: () => void;
  readonly onSkip: (seconds: number) => void;
  readonly onTogglePause: () => void;
  readonly onLive: () => void;
  readonly onExtend: () => void;
  readonly onNextTrack: () => void;
  readonly onOptions: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
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
      {showExtend ? (
        <FocusButton
          label={m.player_extend({ minutes: extendStepMinutes })}
          icon="plus"
          size={size}
          onPress={onExtend}
        />
      ) : null}
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
