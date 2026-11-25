import { useRouter } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { PlaybackSource, RecordingEntry } from "@slipstream/api";
import type { Channel, FitMode } from "@slipstream/domain";
import { useSaveProgress } from "~/api/mutations.ts";
import { formatClock } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { setMiniPlayerItem } from "~/shell/mini-player-store.ts";
import { goPrefixMs } from "~/shell/shortcuts.ts";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import { Badge } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { BackIcon, ExitFullscreenIcon, FullscreenIcon, PanelIcon } from "~/ui/icons.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { IconButton } from "~/ui/primitives/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/ui/primitives/tabs.tsx";
import { Sheet } from "~/ui/sheet/sheet.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { Timeline } from "~/ui/timeline/timeline.tsx";
import { useNow } from "~/ui/use-now.ts";
import { cn } from "~/ui/utils.ts";
import { StatsOverlay } from "./stats-overlay.tsx";
import { LimitError } from "./limit-error.tsx";
import {
  type DetailRow,
  DetailsList,
  PanelClose,
  PanelList,
  type PanelItem,
  type PanelTab,
} from "./panel.tsx";
import {
  CenterTransport,
  type ControlsModel,
  ControlRow,
  PhoneControls,
  ReadRow,
} from "./player-controls.tsx";
import { PlayerError } from "./player-error.tsx";
import { RecordButton, RecordChip } from "./record-now.tsx";
import { type RecordNow, recordAt } from "./use-record-now.ts";
import { controlKeepsKey, type PlayerMenuName, playerKeyFor } from "./player-keys.ts";
import {
  canGoToStart,
  fromStartTime,
  type PagePlayerProblem,
  playerPosition,
  type PlayerPosition,
  type PlayerProblem,
  playerProblem,
  type PlayerSubject,
} from "./player-model.ts";
import { clampVolume, savePrefs, usePlayerPrefs } from "./player-prefs.ts";
import { detailRows, qualityShort } from "./player-text.ts";
import { readoutFor } from "./readout.ts";
import { type StartAt, useHlsPlayback } from "./use-hls-playback.ts";
import { usePinchFit } from "./use-pinch-fit.ts";
import { usePlaybackSession } from "./use-playback-session.ts";
import {
  type PlayerLayout,
  toggleFullscreen,
  useChromeBottom,
  useFullscreen,
  useIdle,
  useOsd,
  usePlayerLayout,
} from "./use-player-chrome.ts";
import {
  progressSaveIntervalMs,
  type QualityChoice,
  qualityRequest,
  recordingProgress,
  stepSpeed,
} from "@slipstream/domain";

/** What the page knows about the recording being played, for Details and the mini player. */
export interface PlayerRecording {
  readonly entry: RecordingEntry;
  /** The item's own name ("Qualifying"), for the mini player. */
  readonly shortTitle: string;
  readonly artwork: ArtworkSubject;
  /** For a running recording: "Recording until 20:30 · by your series recording Formel 1 live" and its actions. */
  readonly running?: {
    readonly until: string;
    readonly onExtend: () => void;
    readonly onStop: () => void;
    readonly busy: boolean;
  };
}

/** Everything the player shows, from the route. */
export interface PlayerProps {
  /** What to play; undefined while the page loads or when there is nothing to play. */
  readonly source: PlaybackSource | undefined;
  readonly start: StartAt;
  readonly title: string;
  readonly subtitle: string;
  readonly badge: "recording" | "live" | "incomplete" | undefined;
  readonly subject: PlayerSubject;
  readonly poster: ArtworkSubject;
  /** Where the quiet way out of an error goes. */
  readonly back: "guide" | "recordings";
  /** The first panel tab: the recording's siblings in its group, or what's up next. */
  readonly next: { readonly label: string; readonly items: readonly PanelItem[] };
  readonly channels: readonly PanelItem[];
  /** Every channel, so the stream-limit error can name what others watch. */
  readonly allChannels: readonly Channel[];
  readonly recording?: PlayerRecording;
  /** The page is still loading what the player shows: titles render as skeletons. */
  readonly loading?: boolean;
  readonly problem?: PagePlayerProblem;
  /** The channel's name, for "so ZDF was refused". */
  readonly channelName: string;
  /** Minutes missing from a finished recording. */
  readonly gapMinutes?: number;
  /** Record for the programme at the playhead; absent for a profile that may not record. */
  readonly recordNow?: RecordNow | undefined;
}

/**
 * The player (SPEC §7.1): the picture fills the viewport, Fill or Fit; the chrome overlays it
 * and fades after 3 s of no input while playing. The pop-in panel is an overlay too, so nothing
 * ever resizes the picture. Phone portrait stacks the controls under the picture; short
 * landscape is the overlay, compact, without bands. Volume, mute, Fill/Fit and the quality
 * override are remembered on this device; the resume position is saved for the profile.
 */
export function Player(props: PlayerProps) {
  const layout = usePlayerLayout();
  const prefs = usePlayerPrefs();
  const router = useRouter();
  const overlay = useOverlay();
  const now = useNow(1000);
  const osd = useOsd();
  const [attempt, setAttempt] = useState(0);
  const session = usePlaybackSession(props.source, qualityRequest(prefs.quality), attempt);
  const {
    videoRef,
    snapshot,
    paused,
    rate: speed,
    status,
    videoSize,
    audioTracks,
    audioTrack,
    subtitleTracks,
    subtitleTrack,
    seekTo,
    seekBy,
    play,
    togglePlay,
    setRate,
    applyVolume,
    setAudioTrack,
    setSubtitleTrack,
    retry: reload,
    readStats,
  } = useHlsPlayback(props.source ? session.session?.playlistUrl : undefined, props.start, {
    onReachedLive: () => {
      osd.show(m.player_badge_live());
    },
    renew: session.renew,
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const readRowRef = useRef<HTMLDivElement | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Until someone picks a tab, the panel opens on the siblings when there are any.
  const [picked, setTab] = useState<PanelTab | undefined>(undefined);
  const tab = picked ?? (props.next.items.length > 0 ? "next" : "channels");
  const [menu, setMenu] = useState<PlayerMenuName | null>(null);
  const fullscreen = useFullscreen();
  const { idle, setResting } = useIdle({
    root: rootRef,
    playing: !paused,
    hold: menu !== null || layout === "portrait" || panelOpen,
  });
  const chromeBottom = useChromeBottom(readRowRef, panelOpen && layout === "overlay");

  const position: PlayerPosition | undefined = snapshot
    ? playerPosition(snapshot, props.subject)
    : undefined;
  const running = props.subject.mode === "running";
  const readout = position
    ? readoutFor({
        position,
        mode: props.subject.mode,
        speed,
        now,
        ...(running && props.recording && props.subject.window
          ? { windowEnd: props.subject.window.end }
          : {}),
        ...(props.gapMinutes === undefined ? {} : { gapMinutes: props.gapMinutes }),
      })
    : undefined;

  // This device's volume follows the remembered preference, also after a reload.
  useEffect(() => {
    applyVolume(prefs.volume, prefs.muted);
    // `status` changes when a stream (re)loads into the element, which then needs it again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [applyVolume, prefs.volume, prefs.muted, status]);

  useProgress({ position, recording: props.recording, playing: !paused, subject: props.subject });
  useLiveHandoff({
    source: props.source,
    recording: props.recording,
    playing: !paused,
    title: props.title,
  });

  const audio = audioTracks.find((track) => track.id === audioTrack) ?? audioTracks[0];
  const changeSpeed = (next: number) => {
    setRate(next);
    osd.show(m.player_speed_value({ speed: next }));
    // Surround sound turns stereo above 1× on the server, once it knows the speed.
    void session.update({ playbackRate: next });
  };
  const setVolume = (volume: number) => {
    const next = clampVolume(volume);
    savePrefs({ volume: next, muted: next === 0 });
    osd.show(next === 0 ? m.player_osd_muted() : m.player_osd_volume({ volume: next }));
  };
  const toggleMute = () => {
    const muted = !(prefs.muted || prefs.volume === 0);
    const volume = prefs.volume === 0 ? 50 : prefs.volume;
    savePrefs({ muted, volume });
    osd.show(muted ? m.player_osd_muted() : m.player_osd_volume({ volume }));
  };
  const setFit = (fit: FitMode) => {
    savePrefs({ fit });
    osd.show(fit === "fit" ? m.player_osd_fit() : m.player_osd_fill());
  };
  const toggleFit = () => setFit(prefs.fit === "fit" ? "fill" : "fit");
  const changeQuality = (quality: QualityChoice) => {
    savePrefs({ quality });
    void session.update({ quality: qualityRequest(quality) });
  };
  const seekTime = (time: number) => {
    if (position) seekTo(position.mediaTimeAt(time));
  };
  const fromStart = () => {
    if (!position) return;
    const target = fromStartTime(props.subject, position);
    seekTime(target);
    play();
    osd.show(
      running
        ? m.player_osd_from_start({ clock: formatClock(target) })
        : m.player_osd_from_start_plain(),
    );
  };
  const goLive = () => {
    if (!position || !running) return;
    seekTime(position.edge);
    if (speed !== 1) setRate(1);
    play();
    osd.show(m.player_badge_live());
  };
  const close = () => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: props.back === "guide" ? "/guide" : "/recordings" });
  };
  const fullscreenToggle = (rotate = false) => {
    void toggleFullscreen(rootRef.current, videoRef.current, { rotate });
  };
  /** The browser's own floating window, which keeps playing over other tabs and apps. */
  const pictureInPicture = () => {
    const video = videoRef.current;
    if (video === null) return;
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture();
    else void video.requestPictureInPicture().catch(() => undefined);
  };
  const retry = () => {
    setAttempt((count) => count + 1);
    reload();
  };
  const recordControl = props.recordNow?.(recordAt(position, now));
  const record = () => {
    if (recordControl?.kind === "record") recordControl.onRecord();
    else if (recordControl?.kind === "recording") osd.show(recordControl.until);
  };

  usePlayerKeys({
    blocked: overlay.current !== null,
    panelOpen,
    act: {
      toggle: togglePlay,
      seek: seekBy,
      fromStart,
      goLive,
      // From the remembered level, so ↑ while muted brings the sound back where it was.
      volume: (delta) => setVolume(prefs.volume + delta),
      mute: toggleMute,
      speed: (direction) => changeSpeed(stepSpeed(speed, direction)),
      menu: setMenu,
      panel: () => setPanelOpen((open) => !open),
      closePanel: () => setPanelOpen(false),
      fit: toggleFit,
      fullscreen: () => fullscreenToggle(),
      record,
      close,
    },
  });

  const fit = prefs.fit === "fit" || layout === "portrait";
  // Portrait shows the picture in its own 16:9 box, where Fit and Fill look the same.
  usePinchFit(rootRef, layout !== "portrait", prefs.fit, setFit);
  const span = props.subject.window;
  // Before the stream loads, the bar shows the window so nothing moves when it arrives.
  const baseTimeline =
    position?.timeline ?? (span ? { start: span.start, end: span.end } : undefined);
  // Short landscape has no room for bands (SPEC §7.1).
  const timeline =
    baseTimeline && layout === "short" ? { ...baseTimeline, bands: [] } : baseTimeline;
  const model: ControlsModel = {
    paused,
    startOk: position ? canGoToStart(position) : false,
    muted: prefs.muted || prefs.volume === 0,
    volume: prefs.volume,
    speed,
    fit: prefs.fit,
    fullscreen,
    quality: prefs.quality,
    qualityLabel: qualityShort(prefs.quality),
    audio,
    audioLabel: audio?.name || m.player_audio_default(),
    tracks: audioTracks,
    subtitles: subtitleTracks,
    subtitle: subtitleTrack,
    menus: { menu, setMenu },
    onToggle: togglePlay,
    onSkip: seekBy,
    onFromStart: fromStart,
    onMute: toggleMute,
    onVolume: setVolume,
    onSpeed: changeSpeed,
    onAudio: setAudioTrack,
    onSubtitle: setSubtitleTrack,
    onQuality: changeQuality,
    onFit: toggleFit,
    onFullscreen: () => fullscreenToggle(),
    onPictureInPicture:
      typeof document !== "undefined" && document.pictureInPictureEnabled
        ? pictureInPicture
        : undefined,
    stats: prefs.stats,
    onStats: (stats) => savePrefs({ stats }),
  };
  const details = detailRows({
    session: session.session,
    audio,
    videoSize,
    speed,
  });
  const recordingControls = props.recording?.running;
  const problem = playerProblem({
    page: props.problem,
    refusal: session.refusal,
    status,
    sessionFailed: session.query.isError,
  });
  const showError = problem !== undefined;

  const badge =
    props.badge === undefined ? null : (
      <Badge tone={props.badge === "live" ? "live" : props.badge === "incomplete" ? "warn" : "rec"}>
        {props.badge === "live"
          ? m.player_badge_live()
          : props.badge === "incomplete"
            ? m.player_badge_incomplete()
            : m.player_badge_recording()}
      </Badge>
    );
  const readRow = (
    <ReadRow
      ref={readRowRef}
      readout={readout}
      running={running}
      onGoLive={goLive}
      atLive={position?.atLive ?? false}
      compact={layout === "short"}
    />
  );
  // One height before the window is known and whether the guide's bands arrived or not: the
  // band row (48 px) is always kept where bands can show. Short landscape has none.
  const timelineNode = (
    <div className={layout === "short" ? "h-[54px]" : "h-[76px]"}>
      {timeline ? (
        <Timeline
          data={timeline}
          relative={!running}
          onSeek={seekTime}
          {...(layout === "short" ? {} : { className: "[--tl-top:48px]" })}
        />
      ) : null}
    </div>
  );
  const chromeIdle = idle && !panelOpen;

  return (
    <div
      ref={rootRef}
      data-player=""
      data-surface="cine"
      data-layout={layout}
      data-paused={paused ? "" : undefined}
      data-idle={chromeIdle ? "" : undefined}
      data-panel={panelOpen ? "" : undefined}
      aria-label={m.player_label({ title: props.title })}
      role="region"
      className={cn(
        "text-fg",
        layout === "portrait"
          ? "min-h-dvh bg-bg"
          : "fixed inset-0 touch-pan-x touch-pan-y overflow-hidden bg-sunken",
        chromeIdle && "cursor-none",
      )}
      style={
        chromeBottom === undefined
          ? undefined
          : ({ "--chrome-b": `${chromeBottom}px` } as CSSProperties)
      }
    >
      <div
        className={cn(
          "overflow-hidden bg-sunken",
          layout === "portrait" ? "sticky top-0 z-10 pt-(--safe-t)" : "absolute inset-0",
        )}
      >
        <div
          className={cn(
            "overflow-hidden",
            layout === "portrait" ? "relative aspect-video w-full" : "absolute inset-0",
          )}
        >
          <Artwork
            subject={props.poster}
            noTitle
            noMark
            className={cn(
              "absolute inset-0 aspect-auto size-full transition-opacity duration-(--t-med)",
              status === "ready" && videoSize !== undefined && "opacity-0",
            )}
          />
          <video
            ref={videoRef}
            className={cn("absolute inset-0 size-full", fit ? "object-contain" : "object-cover")}
            playsInline
            aria-hidden="true"
          />
          {prefs.stats && status === "ready" ? (
            <StatsOverlay
              read={readStats}
              session={session.session}
              videoSize={videoSize}
              className={cn(
                "absolute z-4",
                layout === "portrait"
                  ? "top-2 left-2 w-60 text-[11px]"
                  : layout === "short"
                    ? "top-[calc(var(--safe-t)+64px)] left-[max(12px,var(--safe-l))]"
                    : "top-[calc(var(--safe-t)+84px)] left-[max(20px,var(--safe-l))]",
              )}
            />
          ) : null}
          {layout === "portrait" ? (
            <span className="absolute right-2 bottom-2 z-4">
              <IconButton
                label={fullscreen ? m.player_exit_fullscreen() : m.player_fullscreen()}
                variant="glass"
                tooltip={false}
                onClick={() => fullscreenToggle(true)}
              >
                <Icon icon={fullscreen ? ExitFullscreenIcon : FullscreenIcon} />
              </IconButton>
            </span>
          ) : null}
        </div>
        <Chrome
          layout={layout}
          idle={chromeIdle}
          panelOpen={panelOpen}
          onRest={setResting}
          onStageTap={togglePlay}
          top={
            <>
              <IconButton label={m.action_back()} tooltipSide="bottom" onClick={close}>
                <Icon icon={BackIcon} />
              </IconButton>
              <div className={cn("min-w-0 flex-1", layout === "portrait" && "invisible")}>
                <b className="block truncate text-[16px] font-[650]">{props.title}</b>
                <span className="block truncate text-meta text-fg-2">{props.subtitle}</span>
              </div>
              {layout === "portrait" ? null : (
                <>
                  {/* Live says so in the read-out; the header names only what it doesn't. */}
                  {props.badge === "live" ? null : badge}
                  <IconButton
                    label={m.player_panel_button({ tab: props.next.label })}
                    tooltipSide="left"
                    pressed={panelOpen}
                    onClick={() => setPanelOpen((open) => !open)}
                  >
                    <Icon icon={PanelIcon} />
                  </IconButton>
                </>
              )}
            </>
          }
          center={
            // Phone portrait has its transport under the picture; a tap on the picture plays.
            layout === "portrait" ? null : (
              <CenterTransport
                model={model}
                compact={layout === "short"}
                hidden={status !== "ready" || showError}
              />
            )
          }
          bottom={
            layout === "portrait" ? null : (
              <>
                {readRow}
                {timelineNode}
                <ControlRow
                  model={model}
                  {...(props.recordNow === undefined
                    ? {}
                    : { record: <RecordButton control={recordControl} /> })}
                />
              </>
            )
          }
        />
        {layout === "portrait" ? null : (
          <aside
            aria-label={m.player_panel_label()}
            inert={!panelOpen}
            onPointerEnter={() => setResting(true)}
            onPointerLeave={() => setResting(false)}
            className={cn(
              "absolute right-[max(16px,var(--safe-r))] z-6 flex min-h-0 w-[min(380px,calc(100%-32px))] flex-col rounded-[20px] bg-[color-mix(in_oklab,var(--sunken)_88%,transparent)] shadow-pop backdrop-blur-2xl",
              "overflow-hidden transition-opacity duration-(--t-med)",
              layout === "short"
                ? "top-[calc(var(--safe-t)+8px)] bottom-[calc(var(--safe-b)+8px)]"
                : "top-[calc(var(--safe-t)+72px)] bottom-(--chrome-b,196px)",
              panelOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <PanelTabs
              tab={tab}
              onTab={setTab}
              nextLabel={props.next.label}
              onClose={() => setPanelOpen(false)}
              next={<PanelList items={props.next.items} empty={m.player_panel_empty()} />}
              channels={<PanelList items={props.channels} />}
              details={
                <DetailsList
                  rows={details}
                  {...(recordingControls ? { recording: recordingControls } : {})}
                />
              }
            />
          </aside>
        )}
        <div
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute top-[calc(var(--safe-t)+24px)] left-1/2 z-8 -translate-x-1/2 rounded-full bg-media-scrim px-3.5 py-2 text-label tabular-nums text-fg backdrop-blur-sm transition-opacity duration-(--t-fast)",
            osd.shown ? "opacity-100" : "opacity-0",
          )}
        >
          {osd.text}
        </div>
        {/* On phone portrait the picture is a 16:9 strip: an error covers the whole screen. */}
        <div className={cn(showError && layout === "portrait" && "fixed inset-0 z-20")}>
          <PlayerErrors
            problem={problem}
            back={props.back}
            channelName={props.channelName}
            channels={props.allChannels}
            retry={retry}
          />
        </div>
      </div>
      {layout === "portrait" ? (
        <PhoneBelow
          title={props.title}
          subtitle={props.subtitle}
          badge={props.badge === "live" ? null : badge}
          loading={props.loading ?? false}
          readRow={readRow}
          timeline={timelineNode}
          controls={
            <PhoneControls
              model={model}
              onDetails={() => overlay.open({ kind: "sheet", name: "info" })}
              {...(props.recordNow === undefined
                ? {}
                : { record: <RecordChip control={recordControl} /> })}
            />
          }
          next={props.next}
          channels={props.channels}
        />
      ) : null}
      <InfoSheet rows={details} {...(recordingControls ? { recording: recordingControls } : {})} />
    </div>
  );
}

/**
 * Saves where this profile is in a recording every 15 s while playing and when the player
 * closes, and hands the mini player what it needs to bring you back.
 */
function useProgress(input: {
  readonly position: PlayerPosition | undefined;
  readonly recording: PlayerRecording | undefined;
  readonly playing: boolean;
  readonly subject: PlayerSubject;
}) {
  const { mutate: save } = useSaveProgress();
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const windowStart = input.subject.window?.start;
  useEffect(() => {
    const store = (closing: boolean) => {
      const { position: at, recording } = latest.current;
      if (!at || !recording || windowStart === undefined) return;
      // The position from the padded start and the watched flag, by the rule the TV shares.
      const progress = recordingProgress({
        positionMs: at.position - windowStart,
        durationMs: at.lengthMs,
        state: recording.entry.state,
      });
      save({ target: { _tag: "Recording", recordingId: recording.entry.id }, ...progress });
      const finished = recording.entry.state !== "recording";
      if (!closing) return;
      // Playing on: the mini player takes over. Paused: nothing stays behind.
      setMiniPlayerItem(
        latest.current.playing
          ? {
              kind: "recording",
              id: recording.entry.id,
              title: recording.shortTitle,
              live: !finished,
              resumeT: finished ? Math.round(at.offsetMs) : Math.round(at.position),
            }
          : null,
      );
    };
    const timer = window.setInterval(() => {
      if (latest.current.playing) store(false);
    }, progressSaveIntervalMs);
    return () => {
      window.clearInterval(timer);
      store(true);
    };
  }, [save, windowStart]);
}

/**
 * Hands a live channel that is not being recorded to the mini player when the player closes
 * while it plays (a recording goes through `useProgress`, which knows where you were); closing
 * it paused leaves no mini player behind.
 */
function useLiveHandoff(input: {
  readonly source: PlaybackSource | undefined;
  readonly recording: PlayerRecording | undefined;
  readonly playing: boolean;
  readonly title: string;
}) {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  useEffect(
    () => () => {
      const { source, recording, playing, title } = latest.current;
      if (recording !== undefined || source?._tag !== "Live") return;
      setMiniPlayerItem(
        playing
          ? { kind: "channel", id: source.channelId, title: title || source.channelId }
          : null,
      );
    },
    [],
  );
}

/** What the player keys can do. */
interface KeyActions {
  readonly toggle: () => void;
  readonly seek: (seconds: number) => void;
  readonly fromStart: () => void;
  readonly goLive: () => void;
  readonly volume: (delta: number) => void;
  readonly mute: () => void;
  readonly speed: (direction: 1 | -1) => void;
  readonly menu: (menu: PlayerMenuName) => void;
  readonly panel: () => void;
  readonly closePanel: () => void;
  readonly fit: () => void;
  readonly fullscreen: () => void;
  readonly record: () => void;
  readonly close: () => void;
}

/**
 * The player keys (SPEC §7.2) while no layer above the player (a menu, a sheet, a dialog) is
 * open: those keep their own keys. Esc closes the panel first, then the player.
 */
function usePlayerKeys(input: {
  readonly blocked: boolean;
  readonly panelOpen: boolean;
  readonly act: KeyActions;
}) {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const { blocked } = input;
  useEffect(() => {
    if (blocked) return;
    // `G` then `R` is the global "Go to Recordings": R right after G is not Record.
    let goAt = Number.NEGATIVE_INFINITY;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const afterGo = Date.now() - goAt < goPrefixMs;
      goAt = event.key.toLowerCase() === "g" ? Date.now() : Number.NEGATIVE_INFINITY;
      if (document.querySelector('[data-slot="dropdown-menu-content"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("[data-overlay-root]")) return;
      if (target instanceof HTMLInputElement && target.type !== "range") return;
      if (target instanceof HTMLTextAreaElement) return;
      if (controlKeepsKey(target, event.key)) return;
      const action = playerKeyFor(event);
      if (!action || (action.kind === "record" && afterGo)) return;
      const { act, panelOpen } = latest.current;
      event.preventDefault();
      switch (action.kind) {
        case "toggle":
          act.toggle();
          return;
        case "seek":
          act.seek(action.seconds);
          return;
        case "start":
          act.fromStart();
          return;
        case "live":
          act.goLive();
          return;
        case "volume":
          act.volume(action.delta);
          return;
        case "mute":
          act.mute();
          return;
        case "speed":
          act.speed(action.direction);
          return;
        case "menu":
          act.menu(action.menu);
          return;
        case "panel":
          act.panel();
          return;
        case "fit":
          act.fit();
          return;
        case "fullscreen":
          act.fullscreen();
          return;
        case "record":
          act.record();
          return;
        case "close":
          if (panelOpen) act.closePanel();
          else act.close();
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blocked]);
}

/** The chrome over the picture: scrims, the top row, the centre and the bottom block. */
function Chrome({
  layout,
  idle,
  panelOpen,
  onRest,
  onStageTap,
  top,
  center,
  bottom,
}: {
  layout: PlayerLayout;
  idle: boolean;
  panelOpen: boolean;
  onRest: (resting: boolean) => void;
  onStageTap: () => void;
  top: ReactNode;
  center: ReactNode;
  bottom: ReactNode;
}) {
  // In short landscape the open panel takes the full height and the chrome fades (r1 #11).
  const hideBars = layout === "short" && panelOpen;
  const rest = { onPointerEnter: () => onRest(true), onPointerLeave: () => onRest(false) };
  return (
    <div
      className={cn(
        "absolute inset-0 z-3 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] transition-opacity duration-300",
        idle && "opacity-0",
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 -z-1 bg-linear-to-b from-sunken/80 via-sunken/45 via-45% to-transparent transition-opacity duration-(--t-med)",
          layout === "portrait" ? "h-20" : layout === "short" ? "h-30" : "h-45",
          hideBars && "opacity-0",
        )}
      />
      {layout === "portrait" ? null : (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 -z-1 bg-linear-to-b from-transparent via-sunken/88 via-55% to-sunken/92 transition-opacity duration-(--t-med)",
            layout === "short" ? "h-52" : "h-75",
            hideBars && "opacity-0",
          )}
        />
      )}
      <div
        {...rest}
        inert={hideBars}
        className={cn(
          "flex items-center gap-2 transition-opacity duration-(--t-med) [&_.ibtn]:text-fg",
          layout === "portrait"
            ? "px-2 pt-2 pb-7.5"
            : layout === "short"
              ? "pt-[calc(var(--safe-t)+10px)] pr-[max(12px,var(--safe-r))] pb-6 pl-[max(12px,var(--safe-l))]"
              : "pt-[calc(var(--safe-t)+14px)] pr-[max(20px,var(--safe-r))] pb-12 pl-[max(20px,var(--safe-l))]",
          hideBars && "opacity-0",
        )}
      >
        {top}
      </div>
      <div
        className="grid place-items-center"
        onClick={(event) => {
          // The picture itself: a click toggles play, like every video player.
          if (event.target === event.currentTarget) onStageTap();
        }}
      >
        {center}
      </div>
      {bottom === null ? null : (
        <div
          {...rest}
          inert={hideBars}
          className={cn(
            "grid grid-cols-[minmax(0,1fr)] gap-0.5 transition-opacity duration-(--t-med)",
            layout === "short"
              ? "pt-9 pr-[max(16px,var(--safe-r))] pb-[calc(var(--safe-b)+8px)] pl-[max(16px,var(--safe-l))]"
              : "pt-16 pr-[max(24px,var(--safe-r))] pb-[calc(var(--safe-b)+16px)] pl-[max(24px,var(--safe-l))]",
            hideBars && "opacity-0",
          )}
        >
          {bottom}
        </div>
      )}
    </div>
  );
}

/** The panel's tab row and bodies. */
function PanelTabs({
  tab,
  onTab,
  nextLabel,
  onClose,
  next,
  channels,
  details,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  nextLabel: string;
  onClose: () => void;
  next: ReactNode;
  channels: ReactNode;
  details: ReactNode;
}) {
  const body = "min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain";
  return (
    <Tabs
      value={tab}
      onValueChange={(value: PanelTab) => onTab(value)}
      className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <div className="flex items-center gap-1 border-b border-line pt-2.5 pr-2.5 pl-3.5">
        <TabsList className="min-w-0 flex-1">
          <TabsTrigger value="next">{nextLabel}</TabsTrigger>
          <TabsTrigger value="channels">{m.channels_heading()}</TabsTrigger>
          <TabsTrigger value="details">{m.player_tab_details()}</TabsTrigger>
        </TabsList>
        <PanelClose onClose={onClose} />
      </div>
      <TabsContent value="next" className={body}>
        <div className="p-2">{next}</div>
      </TabsContent>
      <TabsContent value="channels" className={body}>
        <div className="p-2">{channels}</div>
      </TabsContent>
      <TabsContent value="details" className={body}>
        {details}
      </TabsContent>
    </Tabs>
  );
}

/** Phone portrait: everything under the picture, for thumbs. */
function PhoneBelow({
  title,
  subtitle,
  badge,
  loading,
  readRow,
  timeline,
  controls,
  next,
  channels,
}: {
  title: string;
  subtitle: string;
  badge: ReactNode;
  loading: boolean;
  readRow: ReactNode;
  timeline: ReactNode;
  controls: ReactNode;
  next: PlayerProps["next"];
  channels: readonly PanelItem[];
}) {
  return (
    <LoadingScope
      loading={loading}
      className="bg-bg px-(--gutter) pt-4 pb-[calc(var(--safe-b)+40px)]"
    >
      <div className="mb-3 grid gap-1">
        {badge === null ? null : <div className="flex min-h-5.5 items-center gap-2">{badge}</div>}
        <h1 className="font-display text-[22px] leading-[1.15] font-bold tracking-[-0.025em] wrap-break-word">
          <Sk>{title}</Sk>
        </h1>
        <span className="text-[13.5px] text-fg-2 wrap-break-word">
          <Sk>{subtitle}</Sk>
        </span>
      </div>
      {readRow}
      {timeline}
      {controls}
      {next.items.length > 0 ? (
        <section>
          <h2 className="mt-7 mb-2 text-h3">{next.label}</h2>
          <PanelList items={next.items} />
        </section>
      ) : null}
      <section>
        <h2 className="mt-7 mb-2 text-h3">{m.channels_heading()}</h2>
        <PanelList items={channels} />
      </section>
    </LoadingScope>
  );
}

/** Details as a bottom sheet on phone portrait (`?sheet=info`), kept dark like the player. */
function InfoSheet({
  rows,
  recording,
}: {
  rows: readonly DetailRow[];
  recording?: PlayerRecording["running"];
}) {
  const binding = useOverlayBinding("sheet", "info");
  return (
    <Sheet
      open={binding.open}
      onOpenChange={binding.onOpenChange}
      label={m.player_tab_details()}
      halfSnap={false}
      cine
    >
      <DetailsList rows={rows} {...(recording ? { recording } : {})} />
    </Sheet>
  );
}

/** The error to cover the picture with, if any. */
function PlayerErrors({
  problem,
  back,
  channelName,
  channels,
  retry,
}: {
  problem: PlayerProblem | undefined;
  back: "guide" | "recordings";
  channelName: string;
  channels: readonly Channel[];
  retry: () => void;
}) {
  switch (problem?.kind) {
    case undefined:
      return null;
    case "notFound":
      return <PlayerError title={m.player_not_found_title()} back={back} />;
    case "offline":
      return <PlayerError title={m.player_offline_title()} onRetry={retry} back={back} />;
    case "nothing":
      return <PlayerError title={m.player_nothing_title()} back={back} />;
    case "limit":
      return (
        <LimitError
          reason={problem.limit.reason}
          sourceId={problem.limit.sourceId}
          channelName={channelName}
          channels={channels}
          retry={retry}
          back={back}
        />
      );
    case "notCaptured":
      return <PlayerError title={m.playback_not_captured()} back={back} />;
    case "forbidden":
      return <PlayerError title={m.player_not_allowed()} back={back} />;
    case "unsupported":
      return (
        <PlayerError
          title={m.player_unsupported_title()}
          body={m.player_unsupported_body()}
          back={back}
        />
      );
    case "failed":
      return <PlayerError title={m.player_failed_title()} onRetry={retry} back={back} />;
  }
}
