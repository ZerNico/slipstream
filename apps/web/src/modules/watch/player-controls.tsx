import type { ComponentProps, ReactElement, ReactNode, Ref } from "react";
import { m } from "@slipstream/i18n";
import { Icon, type IconSvgElement } from "~/ui/icon.tsx";
import {
  AudioSubtitlesIcon,
  Back10Icon,
  ExitFullscreenIcon,
  Forward10Icon,
  FromStartIcon,
  FullscreenIcon,
  GoLiveIcon,
  InfoIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  VolumeIcon,
  VolumeLowIcon,
  PipIcon,
  SettingsIcon,
} from "~/ui/icons.ts";
import { Badge } from "~/ui/controls.tsx";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";
import { PlayerMenu } from "./player-menu.tsx";
import type { PlayerMenuName } from "./player-keys.ts";
import { audioOptions, qualityOption } from "./player-text.ts";
import type { Readout } from "./readout.ts";
import type { MediaTrack } from "./use-hls-playback.ts";
import {
  type FitMode,
  playbackSpeeds,
  type QualityChoice,
  qualityChoices,
} from "@slipstream/domain";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * The read-out row (SPEC §7.1): the delta in a fixed 1 em box ("−31:30", or the pulsing LIVE
 * pill at live, so the row keeps its height), its label, the quiet line, and the one Go live
 * control, hidden by visibility at live so nothing moves. The row has one fixed height per
 * layout (the delta line, plus the quiet line outside short landscape) and is mounted from the
 * first frame: until the position is known its text is skeleton, so nothing below or beside it
 * moves when the stream starts.
 */
export function ReadRow({
  ref,
  readout,
  running,
  atLive,
  compact,
  onGoLive,
}: {
  ref?: Ref<HTMLDivElement>;
  readout: Readout | undefined;
  running: boolean;
  atLive: boolean;
  compact: boolean;
  onGoLive: () => void;
}) {
  const loading = readout === undefined;
  return (
    <LoadingScope
      loading={loading}
      ref={ref}
      // The delta line (and the quiet line), or the Go live pill where that is taller; the
      // same whether or not the pill shows, since a loading page does not know yet.
      className={cn(
        "flex items-end gap-3",
        compact ? "h-[max(26px,var(--ctl-sm))]" : "h-[max(62px,var(--ctl-sm))]",
      )}
      data-readout=""
    >
      <div className="mr-auto grid min-w-0 gap-1.5">
        {/* One line, its height fixed by the delta's 1 em box: the label never wraps under it. */}
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span
            className={cn(
              "inline-flex h-[1em] min-w-[4.2ch] flex-none items-center font-display leading-none font-bold tracking-[-0.03em] tabular-nums",
              compact ? "text-[26px]" : "text-readout",
              readout?.kind === "live"
                ? "text-live-fg"
                : readout?.kind === "left"
                  ? "text-fg"
                  : "text-brand-fg",
            )}
          >
            {readout?.kind === "live" ? (
              <Badge tone="live" className="font-sans">
                {m.status_live()}
              </Badge>
            ) : (
              <Sk chars={5}>{readout?.delta}</Sk>
            )}
          </span>
          <Sk chars={12} className="min-w-0 truncate text-label text-fg-2">
            {readout?.label}
          </Sk>
        </div>
        {compact ? null : (
          <p className="h-5 truncate text-meta tabular-nums text-fg-3">
            {readout === undefined ? (
              <Sk chars={30} />
            ) : (
              readout.sub.map((part, index) => (
                <span key={part.map((piece) => piece.text).join("")}>
                  {index > 0 ? " · " : ""}
                  {part.map((piece, at) => (
                    <span key={piece.text}>
                      {at > 0 ? " " : ""}
                      {piece.strong ? (
                        <b className="font-semibold text-fg-2">{piece.text}</b>
                      ) : piece.speed ? (
                        <span className="font-[650] text-brand-fg">{piece.text}</span>
                      ) : (
                        piece.text
                      )}
                    </span>
                  ))}
                </span>
              ))
            )}
          </p>
        )}
      </div>
      {running ? (
        <Button
          variant="live"
          size="sm"
          icon={<Icon icon={GoLiveIcon} size={16} />}
          onClick={onGoLive}
          className={cn("flex-none", (atLive || loading) && "invisible")}
        >
          {m.player_go_live()}
        </Button>
      ) : null}
    </LoadingScope>
  );
}

/** An option chip under the phone transport (Record, audio, quality, Details). */
export function PhoneChip({
  icon,
  children,
  className,
  ...props
}: ComponentProps<"button"> & { icon?: IconSvgElement }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        // A long track name ("English (Audio description)") shrinks its own chip, not the row.
        "inline-flex h-(--ctl-md) min-w-11 shrink items-center justify-center gap-1.5 rounded-full px-3 text-[13.5px] font-[550] whitespace-nowrap shadow-[inset_0_0_0_1px_var(--line-2)] max-[389px]:px-2.5",
        "text-fg-2 disabled:opacity-45",
        focusRing,
        className,
      )}
    >
      {icon === undefined ? null : <Icon icon={icon} size={16} className="flex-none" />}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** Which menu is open, shared by the keys (A, Q) and the triggers. */
interface MenuState {
  readonly menu: PlayerMenuName | null;
  readonly setMenu: (menu: PlayerMenuName | null) => void;
}

/** Audio tracks and subtitles. */
function AudioMenu({
  state,
  tracks,
  audio,
  subtitles,
  subtitle,
  onAudio,
  onSubtitle,
  trigger,
}: {
  state: MenuState;
  tracks: readonly MediaTrack[];
  audio: MediaTrack | undefined;
  subtitles: readonly MediaTrack[];
  subtitle: number;
  onAudio: (id: number) => void;
  onSubtitle: (id: number) => void;
  trigger: ReactElement;
}) {
  return (
    <PlayerMenu
      name="audio"
      label={m.player_audio()}
      open={state.menu === "audio"}
      onOpenChange={(open) => state.setMenu(open ? "audio" : null)}
      trigger={trigger}
      groups={[
        {
          label: m.player_details_audio(),
          value: String(audio?.id ?? 0),
          options: audioOptions(tracks),
          onChange: (value) => onAudio(Number(value)),
        },
        {
          label: m.player_subtitles_heading(),
          value: String(subtitle),
          options: [
            { value: "-1", label: m.player_subtitles_off() },
            ...subtitles.map((track) => ({ value: String(track.id), label: track.name })),
          ],
          onChange: (value) => onSubtitle(Number(value)),
        },
      ]}
    />
  );
}

/** Options: how the picture fills the screen (first, as a pair), quality, speed and stats. */
function OptionsMenu({ model, trigger }: { model: ControlsModel; trigger: ReactElement }) {
  return (
    <PlayerMenu
      name="quality"
      label={m.action_options()}
      open={model.menus.menu === "quality"}
      onOpenChange={(open) => model.menus.setMenu(open ? "quality" : null)}
      trigger={trigger}
      groups={[
        {
          label: m.player_picture_heading(),
          value: model.fit,
          options: [
            { value: "fit", label: m.player_fit_short() },
            { value: "fill", label: m.player_fill_short() },
          ],
          layout: "pair",
          onChange: (value) => {
            if (value !== model.fit) model.onFit();
          },
        },
        {
          label: m.player_quality(),
          value: model.quality,
          options: qualityChoices.map(qualityOption),
          onChange: (value) => {
            const picked = qualityChoices.find((choice) => choice === value);
            if (picked) model.onQuality(picked);
          },
        },
        {
          label: m.player_speed(),
          value: String(model.speed),
          options: playbackSpeeds.map((value) => ({
            value: String(value),
            label:
              value === 1
                ? m.player_speed_normal({ speed: 1 })
                : m.player_speed_value({ speed: value }),
          })),
          onChange: (value) => model.onSpeed(Number(value)),
        },
        {
          label: m.player_stats(),
          value: model.stats ? "on" : "off",
          options: [
            { value: "off", label: m.player_stats_off() },
            { value: "on", label: m.player_stats_on() },
          ],
          onChange: (value) => model.onStats(value === "on"),
        },
      ]}
    />
  );
}

/**
 * The transport in the middle of the picture (desktop and short landscape): −10 s, play or
 * pause, +10 s, on frosted glass like the rest of the chrome. It fades with the chrome.
 */
export function CenterTransport({
  model,
  compact,
  hidden,
}: {
  model: ControlsModel;
  compact: boolean;
  hidden: boolean;
}) {
  const side = cn(
    "grid place-items-center rounded-full text-fg transition-[transform,background-color] duration-(--t-fast)",
    "bg-[color-mix(in_oklab,var(--art-ink)_12%,transparent)] backdrop-blur-xl backdrop-saturate-150",
    "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--art-ink)_12%,transparent)]",
    "fine:hover:scale-105 fine:hover:bg-[color-mix(in_oklab,var(--art-ink)_20%,transparent)] active:scale-95",
    focusRing,
  );
  return (
    <div
      className={cn(
        "flex items-center transition-opacity duration-(--t-med)",
        compact ? "gap-5" : "gap-8",
        hidden && "invisible opacity-0",
      )}
    >
      <button
        type="button"
        aria-label={m.player_back10()}
        onClick={() => model.onSkip(-10)}
        className={cn(side, compact ? "size-12" : "size-14")}
      >
        <Icon icon={Back10Icon} size={24} className={compact ? "size-5.5" : "size-6.5"} />
      </button>
      <button
        type="button"
        aria-label={model.paused ? m.player_play() : m.player_pause()}
        onClick={model.onToggle}
        className={cn(side, compact ? "size-16" : "size-20")}
      >
        <Icon
          icon={model.paused ? PlayIcon : PauseIcon}
          size={24}
          className={compact ? "size-7.5" : "size-9"}
        />
      </button>
      <button
        type="button"
        aria-label={m.player_forward10()}
        onClick={() => model.onSkip(10)}
        className={cn(side, compact ? "size-12" : "size-14")}
      >
        <Icon icon={Forward10Icon} size={24} className={compact ? "size-5.5" : "size-6.5"} />
      </button>
    </div>
  );
}

/** What the control rows show and do. */
export interface ControlsModel {
  readonly paused: boolean;
  readonly startOk: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly speed: number;
  readonly fit: FitMode;
  readonly fullscreen: boolean;
  readonly quality: QualityChoice;
  readonly qualityLabel: string;
  readonly audio: MediaTrack | undefined;
  readonly audioLabel: string;
  readonly tracks: readonly MediaTrack[];
  readonly subtitles: readonly MediaTrack[];
  readonly subtitle: number;
  readonly menus: MenuState;
  readonly onToggle: () => void;
  readonly onSkip: (seconds: number) => void;
  readonly onFromStart: () => void;
  readonly onMute: () => void;
  readonly onVolume: (volume: number) => void;
  readonly onSpeed: (speed: number) => void;
  readonly onAudio: (id: number) => void;
  readonly onSubtitle: (id: number) => void;
  readonly onQuality: (quality: QualityChoice) => void;
  readonly onFit: () => void;
  readonly onFullscreen: () => void;
  /** The browser's picture-in-picture, where it has one. */
  readonly onPictureInPicture: (() => void) | undefined;
  /** The playback stats overlay. */
  readonly stats: boolean;
  readonly onStats: (on: boolean) => void;
}

/**
 * The desktop control row under the timeline (SPEC §7.1): From start and volume on the left;
 * audio and subtitles, Options (quality, speed, picture), picture-in-picture and full screen on
 * the right. Play and the skips sit in the middle of the picture (`CenterTransport`).
 */
export function ControlRow({ model, record }: { model: ControlsModel; record?: ReactNode }) {
  return (
    <div className="flex h-(--ctl-lg) items-center gap-1 [&_.ibtn:not(.ibtn-live)]:text-fg">
      <IconButton
        label={m.player_from_start()}
        onClick={model.onFromStart}
        disabled={!model.startOk}
      >
        <Icon icon={FromStartIcon} />
      </IconButton>
      <div className="group/vol flex items-center gap-0.5">
        <IconButton
          label={model.muted ? m.player_unmute_action() : m.player_mute_action()}
          pressed={model.muted}
          onClick={model.onMute}
        >
          <Icon icon={model.muted ? MuteIcon : model.volume < 45 ? VolumeLowIcon : VolumeIcon} />
        </IconButton>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={model.muted ? 0 : model.volume}
          aria-label={m.player_volume()}
          aria-valuetext={
            model.muted ? m.player_osd_muted() : m.player_volume_value({ volume: model.volume })
          }
          onChange={(event) => model.onVolume(Number(event.currentTarget.value))}
          className="h-(--ctl-md) w-18 cursor-pointer accent-fg lg:w-24 coarse:hidden"
        />
      </div>
      <span className="flex-1" />
      {record}
      {model.speed === 1 ? null : (
        <span className="px-2 text-[13.5px] font-semibold text-brand-fg tabular-nums" data-speed="">
          {m.player_speed_value({ speed: model.speed })}
        </span>
      )}
      <AudioMenu
        state={model.menus}
        tracks={model.tracks}
        audio={model.audio}
        subtitles={model.subtitles}
        subtitle={model.subtitle}
        onAudio={model.onAudio}
        onSubtitle={model.onSubtitle}
        trigger={
          <IconButton label={m.player_audio()}>
            <Icon icon={AudioSubtitlesIcon} />
          </IconButton>
        }
      />
      <OptionsMenu
        model={model}
        trigger={
          <IconButton label={m.action_options()}>
            <Icon icon={SettingsIcon} />
          </IconButton>
        }
      />
      {model.onPictureInPicture === undefined ? null : (
        <IconButton
          label={m.player_picture_in_picture()}
          className="coarse:hidden"
          onClick={model.onPictureInPicture}
        >
          <Icon icon={PipIcon} />
        </IconButton>
      )}
      <IconButton
        label={model.fullscreen ? m.player_exit_fullscreen() : m.player_fullscreen()}
        onClick={model.onFullscreen}
      >
        <Icon icon={model.fullscreen ? ExitFullscreenIcon : FullscreenIcon} />
      </IconButton>
    </div>
  );
}

/**
 * Phone portrait: the five-button transport (From start, −10, play, +10, Mute; 48 px, play 60)
 * and the option chips (audio, Options, Info) on one row at every phone width.
 */
export function PhoneControls({
  model,
  onDetails,
  record,
}: {
  model: ControlsModel;
  onDetails: () => void;
  /** The Record chip, first, for a profile that may record. */
  record?: ReactNode;
}) {
  return (
    <>
      <div className="mt-1 flex items-center justify-between [&_.ibtn]:size-12 [&_.ibtn]:text-fg">
        <IconButton
          label={m.player_from_start()}
          onClick={model.onFromStart}
          disabled={!model.startOk}
          tooltip={false}
        >
          <Icon icon={FromStartIcon} />
        </IconButton>
        <IconButton label={m.player_back10()} onClick={() => model.onSkip(-10)} tooltip={false}>
          <Icon icon={Back10Icon} />
        </IconButton>
        <button
          type="button"
          aria-label={model.paused ? m.player_play() : m.player_pause()}
          onClick={model.onToggle}
          className={cn(
            "grid size-15 place-items-center rounded-full bg-[color-mix(in_oklab,var(--fg)_12%,transparent)] text-fg transition-transform duration-(--t-fast) active:scale-95",
            focusRing,
          )}
        >
          <Icon icon={model.paused ? PlayIcon : PauseIcon} size={24} />
        </button>
        <IconButton label={m.player_forward10()} onClick={() => model.onSkip(10)} tooltip={false}>
          <Icon icon={Forward10Icon} />
        </IconButton>
        <IconButton
          label={model.muted ? m.player_unmute_action() : m.player_mute_action()}
          pressed={model.muted}
          onClick={model.onMute}
          tooltip={false}
        >
          <Icon icon={model.muted ? MuteIcon : VolumeIcon} />
        </IconButton>
      </div>
      <div className="mt-3.5 flex gap-2 max-[389px]:gap-1.5">
        {record}
        <AudioMenu
          state={model.menus}
          tracks={model.tracks}
          audio={model.audio}
          subtitles={model.subtitles}
          subtitle={model.subtitle}
          onAudio={model.onAudio}
          onSubtitle={model.onSubtitle}
          trigger={<PhoneChip icon={AudioSubtitlesIcon}>{model.audioLabel}</PhoneChip>}
        />
        <OptionsMenu
          model={model}
          trigger={<PhoneChip icon={SettingsIcon}>{model.qualityLabel}</PhoneChip>}
        />
        <PhoneChip icon={InfoIcon} onClick={onDetails}>
          {m.player_tab_details()}
        </PhoneChip>
      </div>
    </>
  );
}
