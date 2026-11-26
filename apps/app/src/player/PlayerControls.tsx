import type { ChannelId } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import type { ReactNode } from "react";
import { Pressable, Text, TVFocusGuideView, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { ChannelArt } from "../ui/ChannelArt.tsx";
import { Chip } from "../ui/Chip.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { SKIP_FORWARD_SECONDS, SKIP_SECONDS } from "./controls.ts";

/**
 * The overlay's top line: Back (phone), the channel's logo, what plays (the programme at the
 * playhead, with its episode, channel and slot under it), the recording chip,
 * picture-in-picture (phone) and the clock. Long titles end in an ellipsis, so nothing moves.
 */
export const TopBar = ({
  title,
  line,
  channelId,
  recordingNow,
  now,
  size,
  pad,
  onBack,
  onPictureInPicture,
}: {
  readonly title: string;
  /** "Episode 4 · Der Fall · Das Erste · 20:15–21:45", or empty. */
  readonly line: string;
  /** The channel whose logo leads the line, when it is known. */
  readonly channelId: ChannelId | undefined;
  readonly recordingNow: boolean;
  readonly now: number;
  readonly size: number;
  readonly pad: number;
  readonly onBack: () => void;
  readonly onPictureInPicture?: (() => void) | undefined;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  const logo = 2.4 * size * em;
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
      {channelId === undefined ? null : (
        <View style={{ width: 1.6 * logo, height: logo }}>
          <ChannelArt channelId={channelId} height={logo} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.fUiSemiBold,
            fontSize: 1.45 * size * em,
            color: colors.fg,
          }}
        >
          {title}
        </Text>
        {/* Always a line high, so the title never moves when the guide answers. */}
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.fUi,
            fontSize: 0.95 * size * em,
            color: colors.fg2,
            fontVariant: ["tabular-nums"],
          }}
        >
          {line.length > 0 ? line : " "}
        </Text>
      </View>
      {recordingNow ? <Chip label={m.status_recording()} tone="rec" size={0.85 * size} /> : null}
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
  onFocus,
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
  /** Focus moved to one of the row's buttons (TV). */
  readonly onFocus: () => void;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  return (
    // TV: left and right move along the row and stop at its ends, down goes nowhere, and up
    // leaves only for the timeline; coming back, focus lands where it left the row.
    <TVFocusGuideView
      autoFocus
      trapFocusLeft
      trapFocusRight
      trapFocusDown
      style={{ flexDirection: "row", alignItems: "center", gap: 0.7 * em }}
    >
      <FocusButton
        onFocus={onFocus}
        label={m.player_from_start()}
        icon="start"
        iconOnly
        size={size}
        onPress={onFromStart}
      />
      <FocusButton
        onFocus={onFocus}
        label={m.player_skip_back({ seconds: SKIP_SECONDS })}
        icon="back"
        iconOnly
        size={size}
        onPress={() => onSkip(-SKIP_SECONDS)}
      />
      <FocusButton
        onFocus={onFocus}
        label={paused ? m.player_play() : m.player_pause()}
        icon={paused ? "play" : "pause"}
        iconOnly
        // Not amber at rest: amber means focus everywhere, so it never doubles for it.
        preferredFocus={playFocus}
        size={1.2 * size}
        onPress={onTogglePause}
      />
      <FocusButton
        onFocus={onFocus}
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
        <FocusButton
          label={m.player_watch_live()}
          icon="live"
          size={size}
          onPress={onLive}
          onFocus={onFocus}
        />
      ) : null}
      {record === undefined ? null : (
        <FocusButton
          onFocus={onFocus}
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
        <FocusButton
          label={track}
          icon="audio"
          iconOnly
          size={size}
          onPress={onNextTrack}
          onFocus={onFocus}
        />
      )}
      <FocusButton
        onFocus={onFocus}
        label={m.action_options()}
        icon="settings"
        iconOnly
        size={size}
        preferredFocus={optionsFocus}
        onPress={onOptions}
      />
    </TVFocusGuideView>
  );
};

/**
 * The timeline as the TV's focus sees it: one focusable stop above the controls row. While it
 * has focus the player scrubs with left and right, so focus never leaves it sideways (or up);
 * only down goes back to the row. OK is the player's (commit the scrub, or play and pause), so
 * the stop itself presses nothing. On phone it is just the timeline.
 */
export const TimelineFocus = ({
  onFocus,
  children,
}: {
  readonly onFocus: () => void;
  readonly children: ReactNode;
}) => {
  const { isTV } = useTheme();
  if (!isTV) return children;
  return (
    <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight trapFocusUp>
      <Pressable focusable accessibilityLabel={m.timeline_position_label()} onFocus={onFocus}>
        {children}
      </Pressable>
    </TVFocusGuideView>
  );
};
