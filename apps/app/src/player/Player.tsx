import {
  epochMs,
  extendPadding,
  holdSpeed,
  liveEta,
  padRange,
  type QualityChoice,
  qualityRequest,
} from "@slipstream/domain";
import { formatLocale, formatters, m, streamLimitText } from "@slipstream/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  StyleSheet,
  Text,
  useTVEventHandler,
  useWindowDimensions,
  View,
  type TVRemoteEvent,
} from "react-native";
import Video, {
  SelectedTrackType,
  ViewType,
  type AudioTrack,
  type OnProgressData,
  type VideoRef,
} from "react-native-video";
import { queryKeys } from "../api/keys.ts";
import { apiActions } from "../api/queries.ts";
import { useApiQueries } from "../data/hooks.ts";
import { useSession } from "../session/session-context.ts";
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from "react-native-reanimated";
import { SchemeOverride, useTheme } from "../theme/theme.ts";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { CaptureTimeline } from "../ui/CaptureTimeline.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { StatusScreen } from "../ui/StatusScreen.tsx";
import { useToast } from "../ui/toast.ts";
import { readPress } from "../tv/guide/remote.ts";
import {
  hideControls,
  initialControls,
  keepControls,
  playerKeyFor,
  reduceKey,
  shownControls,
  tapPicture,
  tickControls,
  type ControlsState,
  type PlayerCommand,
} from "./controls.ts";
import {
  isAuthRefusal,
  parsePlayerParams,
  positionForInstant,
  type PlayerParams,
  type SessionFailure,
} from "./playback.ts";
import { OptionsSheet } from "./OptionsSheet.tsx";
import { PictureGestures } from "./PictureGestures.tsx";
import { ControlsRow, TopBar } from "./PlayerControls.tsx";
import { savePrefs, usePlayerPrefs } from "./player-prefs.ts";
import { makeProgressSaver, progressAt, type ProgressSaver } from "./progress.ts";
import {
  behindLive,
  isAtLive,
  liveTarget,
  relativeTarget,
  startTarget,
  type PlayerProgress,
} from "./seek.ts";
import { usePlaybackSession } from "./use-playback-session.ts";

/** A readable name for an audio track: its language in the reader's language, else its title. */
const trackLabel = (track: AudioTrack): string => {
  if (track.language !== undefined && track.language.length > 0) {
    try {
      const names = new Intl.DisplayNames([formatLocale()], { type: "language" });
      const name = names.of(track.language);
      if (name !== undefined) return name.charAt(0).toUpperCase() + name.slice(1);
    } catch {
      // Unknown or malformed language code: fall through to the title.
    }
  }
  return track.title ?? m.player_track({ index: track.index + 1 });
};

/**
 * What the player says when it cannot play: no free stream (the source's, or this profile's
 * share, as on the web), no longer in pause & rewind, not allowed for this profile, gone, or
 * anything else.
 */
const failureText = (
  failure: SessionFailure,
): { readonly title: string; readonly body: string | undefined } => {
  switch (failure._tag) {
    case "StreamLimitReached":
      return streamLimitText(failure.reason);
    case "RangeNotCaptured":
      return { title: m.playback_not_captured(), body: undefined };
    case "Forbidden":
      return { title: m.player_not_allowed(), body: undefined };
    case "NotFound":
      return { title: m.error_not_found(), body: undefined };
    case "Other":
      return { title: m.error_unexpected(), body: undefined };
  }
};

/**
 * The read-out right under the timeline: a finished recording says what is left and when it
 * ends; anything with a live edge says how far behind live it is (`deltaText`).
 */
const readoutText = (
  finished: boolean,
  progress: PlayerProgress | undefined,
  now: number,
  deltaText: string,
): string => {
  if (!finished || progress === undefined) return deltaText;
  const f = formatters();
  const left = Math.max(0, progress.seekableDuration - progress.currentTime);
  return `${f.behind(left)} · ${m.player_sub_ends({ clock: f.time(new Date(now + left * 1000)) })}`;
};

/**
 * One playback attempt (design doc "TV · Player"): plays the server's signed HLS playlist with
 * react-native-video (Media3) and our own controls. Three states on TV: hidden (left and right
 * skip 10 s and flash the delta), timeline (scrub with accelerating steps) and the controls row
 * (pause, from start, live, audio track, extend, Options with quality, speed and Fit/Fill). On
 * phone the controls show on tap.
 * Recordings store where this profile is (every 15 s while playing, on pause and on close), so
 * resuming works on every device.
 */
const PlayerBody = ({ onRetry }: { readonly onRetry: () => void }) => {
  const { colors, em, fonts, isTV, motion } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<Record<keyof PlayerParams, string>>();
  const { kind, channelId, recordingId: recordingParam, start, end, from } = params;
  const target = useMemo(
    () => parsePlayerParams({ kind, channelId, recordingId: recordingParam, start, end, from }),
    [kind, channelId, recordingParam, start, end, from],
  );
  const prefs = usePlayerPrefs();
  const {
    state: session,
    update: updateSession,
    changeQuality: requestQuality,
    recover,
    playing: reportPlaying,
  } = usePlaybackSession(target, qualityRequest(prefs.quality));
  const [optionsOpen, setOptionsOpen] = useState(false);
  // TV: after Options closes, focus goes back to its button rather than nowhere.
  const [optionsClosed, setOptionsClosed] = useState(false);
  const optionsOpenRef = useRef(optionsOpen);
  useEffect(() => {
    optionsOpenRef.current = optionsOpen;
  }, [optionsOpen]);
  const { runAction } = useSession();
  const queries = useApiQueries();
  const queryClient = useQueryClient();
  const toast = useToast();
  const recordingId = target?._tag === "Recording" ? target.recordingId : undefined;
  const recording = useQuery(queries.recording(recordingId));
  // Live and a captured range have no recording to name them: the channel does.
  const channelOfTarget = target?._tag === "Recording" ? undefined : target?.channelId;
  const channels = useQuery({ ...queries.channels(), enabled: channelOfTarget !== undefined });
  const title =
    recording.data?.title ??
    channels.data?.find((channel) => channel.id === channelOfTarget)?.name ??
    "";

  const video = useRef<VideoRef>(null);
  const [progress, setProgress] = useState<PlayerProgress | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  // A finger held on the picture (phone) plays fast until it lifts or playback reaches live.
  const [holding, setHolding] = useState(false);
  // In picture-in-picture only the picture shows: no controls, no hints.
  const [inPip, setInPip] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tracks, setTracks] = useState<readonly AudioTrack[]>([]);
  const [trackIndex, setTrackIndex] = useState<number | undefined>(undefined);
  // Phone opens with its controls up (they hide by themselves); TV with them hidden.
  const [controls, setControls] = useState<ControlsState>(() =>
    isTV ? initialControls : shownControls(Date.now()),
  );
  const [now, setNow] = useState(() => Date.now());
  const initialSeekDone = useRef(false);
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);
  // The controls row shown again starts on play, not on Options.
  const [lastMode, setLastMode] = useState(controls.mode);
  if (controls.mode !== lastMode) {
    setLastMode(controls.mode);
    if (controls.mode === "hidden") setOptionsClosed(false);
  }

  // Resume position for recordings. The saver reads the recording's state when it saves, so a
  // recording that finishes while it plays can still end up watched.
  const recordingState = recording.data?.state;
  const recordingNow = recordingState === "recording";
  // A finished recording has no live edge: the read-out says what is left instead.
  const finished = target?._tag === "Recording" && !recordingNow;
  const recordingStateRef = useRef(recordingState);
  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);
  // A renewed playlist URL (before the token expires, or after the server refused it) reloads
  // the stream: note where playback was, and go back there once the new playlist has loaded.
  // Live stays live; anywhere else keeps its position.
  const uri = session._tag === "Ready" ? session.session.uri : undefined;
  const shownUri = useRef(uri);
  const restore = useRef<{ readonly live: boolean; readonly seconds: number } | undefined>(
    undefined,
  );
  const reloaded = useRef(false);
  useEffect(() => {
    const previous = shownUri.current;
    shownUri.current = uri;
    const last = progressRef.current;
    if (uri === undefined || previous === undefined || uri === previous || last === undefined) {
      return;
    }
    if (!initialSeekDone.current) return;
    const hasLiveEdge =
      target?._tag === "Live" ||
      (target?._tag === "Recording" && recordingStateRef.current === "recording");
    restore.current = { live: hasLiveEdge && isAtLive(last), seconds: last.currentTime };
    reloaded.current = false;
  }, [uri, target]);

  const saver = useRef<ProgressSaver | undefined>(undefined);
  useEffect(() => {
    if (recordingId === undefined) return;
    const current = makeProgressSaver((at, reason) => {
      runAction(apiActions.saveProgress(progressAt(recordingId, at, recordingStateRef.current)))
        .then(() =>
          // The timer only keeps the server current; a pause or close refreshes what the
          // screens show (progress bars, Continue watching).
          reason === "tick"
            ? undefined
            : Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
                queryClient.invalidateQueries({ queryKey: queryKeys.continueWatching }),
              ]),
        )
        .catch(() => undefined);
    });
    saver.current = current;
    return () => {
      current.close();
      saver.current = undefined;
    };
  }, [recordingId, runAction, queryClient]);
  useEffect(() => {
    if (paused) saver.current?.pause();
  }, [paused]);

  /** A new speed: the player's rate, and the server, which turns surround stereo off 1×. */
  const changeSpeed = useCallback(
    (next: number) => {
      setSpeed(next);
      updateSession({ playbackRate: next });
    },
    [updateSession],
  );

  // Where the playlist starts and ends on the wall clock: the recording's padded range, to map
  // the server's resume point onto it.
  const padded =
    recording.data === undefined ? undefined : padRange(recording.data, recording.data.padding);
  const windowStart =
    target?._tag === "Range"
      ? target.start
      : padded === undefined
        ? undefined
        : epochMs(padded.start);

  const seek = useCallback((position: number | undefined) => {
    if (position !== undefined) video.current?.seek(position);
  }, []);

  const apply = useCallback(
    (command: PlayerCommand | undefined) => {
      if (command === undefined) return;
      switch (command._tag) {
        case "SeekBy": {
          const current = progressRef.current;
          if (current !== undefined) seek(relativeTarget(current, command.seconds));
          return;
        }
        case "TogglePause":
          setPaused((value) => !value);
          return;
        case "Exit":
          router.back();
          return;
      }
    },
    [router, seek],
  );

  // Remote keys drive the three states; native focus handles the controls row itself.
  const controlsRef = useRef(controls);
  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);
  const onRemote = useCallback(
    (event: TVRemoteEvent) => {
      // The options sheet has the remote while it is open.
      if (optionsOpenRef.current) return;
      const press = readPress(event);
      const key = press === undefined ? undefined : playerKeyFor(press.key);
      if (press === undefined || key === undefined || key === "back") return;
      const result = reduceKey(controlsRef.current, key, press.phase, Date.now());
      controlsRef.current = result.state;
      setControls(result.state);
      apply(result.command);
    },
    [apply],
  );
  useTVEventHandler(onRemote);

  useEffect(() => {
    // A phone's Back leaves the player, as every phone player's does.
    if (!isTV) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const result = reduceKey(controlsRef.current, "back", "down", Date.now());
      if (result.command?._tag === "Exit") return false;
      controlsRef.current = result.state;
      setControls(result.state);
      return true;
    });
    return () => subscription.remove();
  }, [isTV]);

  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      // A paused phone player keeps its controls up.
      setControls((current) => tickControls(current, at, !isTV && pausedRef.current));
    }, 500);
    return () => clearInterval(timer);
  }, [isTV]);

  // The controls fade rather than pop; on phone they stay mounted, so nothing shifts.
  const chromeShown = controls.mode !== "hidden" && !inPip;
  const chromeProgress = useDerivedValue(() =>
    withTiming(chromeShown ? 1 : 0, { duration: motion.tPanel }),
  );
  const chromeFade = useAnimatedStyle(() => ({ opacity: chromeProgress.value }));

  const onProgress = (data: OnProgressData) => {
    const next = { currentTime: data.currentTime, seekableDuration: data.seekableDuration };
    setProgress(next);
    // Faster than real time ends by itself at the live edge (SPEC 7.1).
    if (!finished && isAtLive(next)) {
      if (speed > 1) changeSpeed(1);
      setHolding(false);
    }
    // After a renewed URL, positions are the new playlist's start until the seek back.
    const pending = restore.current;
    if (pending !== undefined) {
      if (!reloaded.current) return;
      restore.current = undefined;
      seek(pending.live ? liveTarget(next) : pending.seconds);
      return;
    }
    // Positions before the first seek are the playlist start, not where playback resumes.
    if (initialSeekDone.current) {
      reportPlaying();
      saver.current?.report(next, Date.now());
      return;
    }
    if (target === undefined || session._tag !== "Ready") return;
    initialSeekDone.current = true;
    if (target.from === "start") seek(startTarget());
    else if (target.from === "live") seek(liveTarget(next));
    else if (session.session.startAt !== undefined) {
      seek(positionForInstant(next, windowStart, session.session.startAt));
    }
  };

  const changeQuality = (quality: QualityChoice) => {
    if (quality === prefs.quality) return;
    savePrefs({ quality });
    requestQuality(qualityRequest(quality));
  };

  const extend = () => {
    const current = recording.data;
    if (current === undefined) return;
    runAction(apiActions.updateRecording(current.id, { padding: extendPadding(current.padding) }))
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }))
      .catch(() => toast({ text: m.library_action_failed() }));
  };

  if (target === undefined) return <StatusScreen title={m.error_not_found()} />;
  if (session._tag === "Starting") return <StatusScreen title={m.loading()} busy />;
  if (session._tag === "Failed" || failed) {
    const problem = failureText(session._tag === "Failed" ? session.failure : { _tag: "Other" });
    return (
      <StatusScreen
        title={problem.title}
        body={problem.body}
        actions={
          <>
            <FocusButton label={m.action_try_again()} preferredFocus onPress={onRetry} />
            <FocusButton label={m.action_back()} variant="ghost" onPress={() => router.back()} />
          </>
        }
      />
    );
  }

  const f = formatters();
  const behind = progress === undefined ? 0 : behindLive(progress);
  const atLive = !finished && (progress === undefined || isAtLive(progress));
  // Above 1x, when playback reaches live, while that falls inside the window (SPEC 7.1).
  const windowEnd =
    target._tag === "Range" ? target.end : padded === undefined ? undefined : epochMs(padded.end);
  const liveAt =
    atLive || finished
      ? undefined
      : liveEta({
          now,
          behindMs: behind * 1000,
          speed,
          ...(windowEnd === undefined ? {} : { windowEnd }),
        });
  const seekable =
    progress !== undefined &&
    Number.isFinite(progress.seekableDuration) &&
    progress.seekableDuration > 0
      ? progress.seekableDuration
      : 1;
  const played = progress === undefined ? 0 : progress.currentTime / seekable;
  const preview =
    controls.scrub === 0 || progress === undefined
      ? undefined
      : (progress.currentTime + controls.scrub) / seekable;
  // TV mounts the controls only while they show (its focus lives in them); phone fades them.
  const showOverlay = isTV ? chromeShown : !inPip;
  const size = isTV ? 1.05 : 0.85;
  const pad = (isTV ? 4 : 1) * em;
  const deltaParts = [
    finished
      ? m.recordings_time_left({ seconds: behind })
      : atLive
        ? m.player_live_at({ now: new Date(now) })
        : m.player_behind_live({ seconds: behind }),
    ...(liveAt === undefined ? [] : [m.player_sub_live_at_time({ start: new Date(liveAt) })]),
  ];
  const deltaText = deltaParts.join(" · ");
  const currentTrack =
    tracks.find((track) => track.index === trackIndex) ??
    tracks.find((track) => track.selected) ??
    tracks[0];

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Video
        ref={video}
        source={{ uri: session.session.uri, type: "m3u8" }}
        style={StyleSheet.absoluteFill}
        resizeMode={prefs.fit === "fill" ? "cover" : "contain"}
        // A TextureView layers like any other view; the default SurfaceView draws over the
        // controls on Android TV, so they never showed.
        viewType={ViewType.TEXTURE}
        controls={false}
        paused={paused}
        rate={holding ? Math.max(speed, holdSpeed) : speed}
        // Leaving the app while it plays keeps the picture in a small window (phone).
        enterPictureInPictureOnLeave={!isTV && !paused}
        onPictureInPictureStatusChanged={(event) => setInPip(event.isActive)}
        progressUpdateInterval={1000}
        selectedAudioTrack={
          trackIndex === undefined
            ? { type: SelectedTrackType.SYSTEM }
            : { type: SelectedTrackType.INDEX, value: trackIndex }
        }
        onProgress={onProgress}
        onBuffer={(event) => setBuffering(event.isBuffering)}
        onReadyForDisplay={() => setBuffering(false)}
        onAudioTracks={(event) => setTracks(event.audioTracks)}
        onLoad={() => {
          reloaded.current = true;
        }}
        onError={(event) => {
          // An expired or refused token: renew the session once and play on from here.
          if (isAuthRefusal(event.error) && recover()) {
            setBuffering(true);
            return;
          }
          setFailed(true);
        }}
      />
      {isTV || inPip ? null : (
        <PictureGestures
          fit={prefs.fit}
          holding={holding}
          onToggleControls={() => setControls((current) => tapPicture(current, Date.now()))}
          onSkip={(seconds) => apply({ _tag: "SeekBy", seconds })}
          onHold={(down) => {
            const fast =
              down &&
              progressRef.current !== undefined &&
              (finished || !isAtLive(progressRef.current));
            setHolding(fast);
            if (fast) setControls(hideControls);
          }}
          onFit={(fit) => savePrefs({ fit })}
        />
      )}
      {controls.pillUntil !== undefined && controls.mode === "hidden" ? (
        <View
          style={{
            position: "absolute",
            bottom: 3 * em,
            left: 4 * em,
            paddingHorizontal: em,
            paddingVertical: 0.5 * em,
            borderRadius: em,
            backgroundColor: colors.media,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.fUiSemiBold,
              fontSize: 1.3 * em,
              color: colors.fg,
              fontVariant: ["tabular-nums"],
            }}
          >
            {deltaText}
          </Text>
        </View>
      ) : null}
      {buffering ? (
        <Text
          style={{
            position: "absolute",
            top: 2.7 * em,
            right: 4 * em,
            fontFamily: fonts.fUi,
            fontSize: em,
            color: colors.fg2,
          }}
        >
          {m.loading()}
        </Text>
      ) : null}
      {showOverlay ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, chromeFade]}
          pointerEvents={chromeShown ? "box-none" : "none"}
          // A touch on the controls keeps them up for another while.
          onTouchStart={() => setControls((current) => keepControls(current, Date.now()))}
        >
          {/* Soft shade at the top and the bottom instead of a band: the picture stays. */}
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none" width="100%" height="100%">
            <Defs>
              <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.bg} stopOpacity="0.75" />
                <Stop offset="0.25" stopColor={colors.bg} stopOpacity="0" />
                <Stop offset="0.45" stopColor={colors.bg} stopOpacity="0" />
                <Stop offset="0.72" stopColor={colors.bg} stopOpacity="0.7" />
                <Stop offset="1" stopColor={colors.bg} stopOpacity="0.92" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#shade)" />
          </Svg>
          <TopBar
            title={title}
            recordingNow={recordingNow}
            now={now}
            size={size}
            pad={pad}
            onBack={() => router.back()}
            onPictureInPicture={
              isTV
                ? undefined
                : () => {
                    video.current?.enterPictureInPicture();
                  }
            }
          />
          <View
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              bottom: (isTV ? 2.4 : 1) * em,
              gap: 0.8 * em,
            }}
          >
            <CaptureTimeline
              width={width - 2 * pad}
              focused={controls.mode === "timeline"}
              marks={{ captured: 1, played, preview, ticks: [] }}
            />
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text
                style={{
                  flex: 1,
                  fontFamily: fonts.fUi,
                  fontSize: size * em,
                  color: colors.fg2,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {progress === undefined ? "" : f.clock(progress.currentTime + controls.scrub)}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.fUiSemiBold,
                  fontSize: size * em,
                  color: atLive ? colors.liveText : colors.fg2,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {readoutText(finished, progress, now, deltaText)}
              </Text>
            </View>
            <ControlsRow
              size={size}
              paused={paused}
              speed={speed}
              showLive={!atLive && !finished}
              showExtend={recordingNow}
              track={
                tracks.length > 1 && currentTrack !== undefined
                  ? trackLabel(currentTrack)
                  : undefined
              }
              playFocus={!optionsOpen && !optionsClosed}
              optionsFocus={!optionsOpen && optionsClosed}
              onFromStart={() => seek(startTarget())}
              onSkip={(seconds) => apply({ _tag: "SeekBy", seconds })}
              onTogglePause={() => setPaused((value) => !value)}
              onLive={() => {
                if (progress !== undefined) seek(liveTarget(progress));
              }}
              onExtend={extend}
              onNextTrack={() => {
                if (currentTrack === undefined) return;
                const position = tracks.indexOf(currentTrack);
                setTrackIndex(tracks[(position + 1) % tracks.length]?.index);
              }}
              onOptions={() => setOptionsOpen(true)}
            />
          </View>
        </Animated.View>
      ) : null}
      {optionsOpen ? (
        <OptionsSheet
          prefs={prefs}
          speed={speed}
          onQuality={changeQuality}
          onSpeed={changeSpeed}
          onFit={(fit) => savePrefs({ fit })}
          onClose={() => {
            setOptionsOpen(false);
            setOptionsClosed(true);
          }}
        />
      ) : null}
    </View>
  );
};

/**
 * The player (design doc "TV · Player"). "Try again" remounts the body, which starts a fresh
 * playback session with a newly signed playlist URL.
 */
export const Player = () => {
  const { isTV } = useTheme();
  const [attempt, setAttempt] = useState(0);
  // Phone: the picture turns sideways while the player is open, as Netflix's does, and the
  // screen it came from gets its own orientation back.
  useEffect(() => {
    if (isTV) return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    return () => {
      ScreenOrientation.unlockAsync().catch(() => undefined);
    };
  }, [isTV]);
  return (
    <SchemeOverride value="dark">
      {isTV ? null : <StatusBar hidden />}
      <PlayerBody key={attempt} onRetry={() => setAttempt((value) => value + 1)} />
    </SchemeOverride>
  );
};
