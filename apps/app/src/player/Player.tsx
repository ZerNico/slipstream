import {
  epochMs,
  extendedEnd,
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
  AppState,
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
  type VideoTrack,
} from "react-native-video";
import type { Effect } from "effect";
import type { Api } from "../api/client.ts";
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
import { HELD_REPEAT_MS, readPress } from "../tv/guide/remote.ts";
import {
  backPress,
  focusPart,
  hideControls,
  initialControls,
  keepControls,
  playerKeyFor,
  reduceKey,
  repeatsWhileHeld,
  shownControls,
  tapPicture,
  tickControls,
  type ControlsState,
  type PlayerCommand,
  type PlayerKey,
} from "./controls.ts";
import {
  isAuthRefusal,
  parsePlayerParams,
  positionForInstant,
  type PlayerParams,
  type SessionFailure,
} from "./playback.ts";
import { RecordSheet } from "../record/RecordSheet.tsx";
import { OptionsSheet } from "./OptionsSheet.tsx";
import { RecordNowSheet } from "./RecordNowSheet.tsx";
import {
  guideWindowAt,
  playerRecord,
  playheadAt,
  recordedText,
  recordingShown,
} from "./record-now.ts";
import { nowPlaying, playingSubject } from "./now-playing.ts";
import { PictureGestures } from "./PictureGestures.tsx";
import { pauseAway, PIP_SETTLE_MS, pipArmed } from "./pip.ts";
import { ControlsRow, TimelineFocus, TopBar } from "./PlayerControls.tsx";
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
import { statsRows } from "./stats.ts";
import { StatsOverlay } from "./StatsOverlay.tsx";
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
  // Record's sheets: the full record options, or Extend and Stop while it records.
  const [recordSheet, setRecordSheet] = useState<"options" | "recording" | undefined>(undefined);
  const [recordBusy, setRecordBusy] = useState(false);
  // While a sheet is open it has the remote.
  const optionsOpenRef = useRef(optionsOpen);
  useEffect(() => {
    optionsOpenRef.current = optionsOpen || recordSheet !== undefined;
  }, [optionsOpen, recordSheet]);
  const { runAction } = useSession();
  const queries = useApiQueries();
  const queryClient = useQueryClient();
  const toast = useToast();
  const recordingId = target?._tag === "Recording" ? target.recordingId : undefined;
  const recording = useQuery(queries.recording(recordingId));
  // The channel of whatever plays: its name and logo lead the top bar.
  const channelOfTarget =
    target?._tag === "Recording" ? recording.data?.channelId : target?.channelId;
  const channels = useQuery({ ...queries.channels(), enabled: channelOfTarget !== undefined });
  const channelName = channels.data?.find((channel) => channel.id === channelOfTarget)?.name;
  // Record: only for a profile that may record; it needs the library (is it recorded already?)
  // and the channel's programmes around the playhead, back as far as the pause buffer reaches.
  const profile = useQuery(queries.myProfile());
  const mayRecord = profile.data?.access.mayRecord === true && target?._tag !== "Range";
  const library = useQuery({ ...queries.recordings(), enabled: mayRecord });
  const [now, setNow] = useState(() => Date.now());
  // The window moves on with the clock, so a session hours long still finds what airs now;
  // the last answer stays while the next window loads (never another channel's).
  // Live and a captured range also name the programme at the playhead from it.
  const guideWindow = guideWindowAt(now);
  const guideChannel = channelOfTarget;
  const channelGuide = useQuery({
    ...queries.channelGuide(guideChannel, guideWindow.from, guideWindow.to),
    enabled: mayRecord || (target !== undefined && target._tag !== "Recording"),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === guideChannel ? previous : undefined,
  });

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
  const inPipRef = useRef(inPip);
  useEffect(() => {
    inPipRef.current = inPip;
  }, [inPip]);
  const [buffering, setBuffering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tracks, setTracks] = useState<readonly AudioTrack[]>([]);
  const [trackIndex, setTrackIndex] = useState<number | undefined>(undefined);
  // What the playback stats read: the picture, its tracks, the bandwidth and the loaded end.
  const [videoSize, setVideoSize] = useState<
    { readonly width: number; readonly height: number } | undefined
  >(undefined);
  const [videoTracks, setVideoTracks] = useState<readonly VideoTrack[]>([]);
  const [networkBitrate, setNetworkBitrate] = useState<number | undefined>(undefined);
  const [loadedTo, setLoadedTo] = useState<number | undefined>(undefined);
  const statsRef = useRef(prefs.stats);
  useEffect(() => {
    statsRef.current = prefs.stats;
  }, [prefs.stats]);
  // Phone opens with its controls up (they hide by themselves); TV with them hidden.
  const [controls, setControls] = useState<ControlsState>(() =>
    isTV ? initialControls : shownControls(Date.now()),
  );
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
        case "CloseStats":
          savePrefs({ stats: false });
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
  // A held arrow arrives once more as a long press and then not again until it comes up, so
  // while it scrubs the timeline the player repeats it, as the guide does.
  const repeating = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stopRepeating = useCallback(() => {
    if (repeating.current !== undefined) clearInterval(repeating.current);
    repeating.current = undefined;
  }, []);
  useEffect(() => stopRepeating, [stopRepeating]);
  const feed = useCallback(
    (key: PlayerKey, phase: "down" | "up") => {
      const result = reduceKey(controlsRef.current, key, phase, Date.now());
      controlsRef.current = result.state;
      setControls(result.state);
      apply(result.command);
    },
    [apply],
  );
  const onRemote = useCallback(
    (event: TVRemoteEvent) => {
      const press = readPress(event);
      if (press?.phase === "up") stopRepeating();
      // The options sheet has the remote while it is open.
      if (optionsOpenRef.current) return;
      const key = press === undefined ? undefined : playerKeyFor(press.key);
      // Back is the BackHandler's alone, so it never counts twice.
      if (press === undefined || key === undefined || key === "back") return;
      feed(key, press.phase);
      if (
        press.held === true &&
        press.phase === "down" &&
        repeatsWhileHeld(controlsRef.current, key)
      ) {
        stopRepeating();
        repeating.current = setInterval(() => {
          if (repeatsWhileHeld(controlsRef.current, key)) feed(key, "down");
          else stopRepeating();
        }, HELD_REPEAT_MS);
      }
    },
    [feed, stopRepeating],
  );
  useTVEventHandler(onRemote);

  // Focus says which part of the shown controls the remote drives (`focusPart`).
  const onFocusPart = useCallback((part: "timeline" | "controls") => {
    const next = focusPart(controlsRef.current, part, Date.now());
    if (next === controlsRef.current) return;
    controlsRef.current = next;
    setControls(next);
  }, []);

  useEffect(() => {
    // A phone's Back leaves the player, as every phone player's does.
    if (!isTV) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const result = backPress(controlsRef.current, statsRef.current, Date.now());
      if (result.command?._tag === "Exit") return false;
      controlsRef.current = result.state;
      setControls(result.state);
      apply(result.command);
      return true;
    });
    return () => subscription.remove();
  }, [isTV, apply]);

  // Picture-in-picture plays on (`pip.ts`); in the background without its window, pause.
  useEffect(() => {
    if (isTV) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        if (pauseAway(AppState.currentState, inPipRef.current)) setPaused(true);
      }, PIP_SETTLE_MS);
    };
    const subscription = AppState.addEventListener("change", check);
    return () => {
      subscription.remove();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isTV]);
  useEffect(() => {
    // The window closed while the app stays in the background: pause, once it has settled.
    if (isTV || inPip) return;
    const timer = setTimeout(() => {
      if (pauseAway(AppState.currentState, inPipRef.current)) setPaused(true);
    }, PIP_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isTV, inPip]);

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
    setLoadedTo(data.playableDuration);
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

  /** Marks what a recording write changes as stale, as the record sheet does. */
  const refreshRecordings = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordOptionsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conflictsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.guideRepeatsAll }),
    ]);
  /** Runs one write of Record's, refreshes what it changed, and says how it went. */
  const recordWrite = <A, E>(effect: Effect.Effect<A, E, Api>, done: (result: A) => string) => {
    if (recordBusy) return;
    setRecordBusy(true);
    runAction(effect)
      .then((result) => refreshRecordings().then(() => toast({ text: done(result) })))
      .catch(() => toast({ text: m.guide_action_failed() }))
      .finally(() => setRecordBusy(false));
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

  // Record for the programme at the playhead (or the recording being played, while it runs).
  const playhead = playheadAt(target, progress, now, windowStart);
  const record = playerRecord({
    target,
    mayRecord,
    playhead,
    now,
    programmes: channelGuide.data ?? [],
    recordings: library.data ?? [],
    playing: recording.data,
  });
  const recordNow = () => {
    if (record?.kind !== "record") return;
    const { programme } = record;
    const pressedAtMs = now;
    recordWrite(
      apiActions.recordProgramme({ _tag: "Programme", programmeId: programme.id }),
      (entry) => recordedText(programme.title, entry, playhead, pressedAtMs),
    );
  };
  const recordProgramme = record?.programme;
  const openRecordOptions =
    recordProgramme === undefined ? undefined : () => setRecordSheet("options");

  // The programme at the playhead, changing as the playhead moves into the next one.
  const playing = nowPlaying(
    playingSubject({
      target,
      atMs: playhead.atMs,
      programmes: channelGuide.data ?? [],
      recording: recording.data,
    }),
    channelName,
  );
  const stats = prefs.stats
    ? statsRows({
        videoSize,
        tracks: videoTracks,
        plan: session.session.plan,
        networkBitrate,
        position:
          progress === undefined || loadedTo === undefined
            ? undefined
            : { currentTime: progress.currentTime, playableDuration: loadedTo },
      })
    : undefined;

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
        // Media3's own LIVE badge sits in the corner whatever our controls do; they say live.
        controlsStyles={{ hideLiveBadge: true }}
        paused={paused}
        rate={holding ? Math.max(speed, holdSpeed) : speed}
        // Leaving the app while it plays keeps the picture in a small window (phone), and it
        // keeps playing there (`pip.ts`).
        enterPictureInPictureOnLeave={pipArmed(isTV, paused)}
        playInBackground={pipArmed(isTV, paused)}
        onPictureInPictureStatusChanged={(event) => setInPip(event.isActive)}
        reportBandwidth={prefs.stats}
        onBandwidthUpdate={(event) => setNetworkBitrate(event.bitrate)}
        onVideoTracks={(event) => setVideoTracks(event.videoTracks)}
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
        onLoad={(event) => {
          reloaded.current = true;
          setVideoSize(event.naturalSize);
          setVideoTracks(event.videoTracks);
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
      {stats === undefined || inPip ? null : (
        <StatsOverlay rows={stats} top={(isTV ? 7.4 : 4.6) * em} left={pad} />
      )}
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
            title={playing.title}
            line={playing.line}
            channelId={channelOfTarget}
            recordingNow={recordingNow || recordingShown(record)}
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
            <TimelineFocus onFocus={() => onFocusPart("timeline")}>
              <CaptureTimeline
                width={width - 2 * pad}
                focused={isTV && controls.mode === "timeline"}
                focusable={isTV}
                marks={{ captured: 1, played, preview, ticks: [], live: !finished }}
              />
            </TimelineFocus>
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
              record={
                record === undefined
                  ? undefined
                  : {
                      kind: record.kind,
                      busy: recordBusy,
                      onPress:
                        record.kind === "record" ? recordNow : () => setRecordSheet("recording"),
                      onLongPress: openRecordOptions,
                    }
              }
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
              onNextTrack={() => {
                if (currentTrack === undefined) return;
                const position = tracks.indexOf(currentTrack);
                setTrackIndex(tracks[(position + 1) % tracks.length]?.index);
              }}
              onOptions={() => setOptionsOpen(true)}
              onFocus={() => onFocusPart("controls")}
            />
          </View>
        </Animated.View>
      ) : null}
      {recordSheet === "recording" && record?.kind === "recording" ? (
        <RecordNowSheet
          title={record.programme?.title ?? record.recording.title}
          until={m.player_recording_extended({
            end: new Date(epochMs(padRange(record.recording, record.recording.padding).end)),
          })}
          onExtend={() => {
            const { id, padding } = record.recording;
            const until = extendedEnd(record.recording, padding);
            recordWrite(apiActions.updateRecording(id, { padding: extendPadding(padding) }), () =>
              m.player_recording_extended({ end: new Date(until) }),
            );
          }}
          onStop={() =>
            recordWrite(apiActions.stopRecording(record.recording.id), () =>
              m.player_recording_stopped(),
            )
          }
          onOptions={openRecordOptions}
          onClose={() => setRecordSheet((open) => (open === "recording" ? undefined : open))}
        />
      ) : null}
      {recordSheet === "options" && recordProgramme !== undefined ? (
        <RecordSheet
          programme={recordProgramme}
          channelName={
            channels.data?.find((channel) => channel.id === recordProgramme.channelId)?.name ?? ""
          }
          recordings={library.data ?? []}
          conflicts={[]}
          onClose={() => setRecordSheet(undefined)}
        />
      ) : null}
      {optionsOpen ? (
        <OptionsSheet
          prefs={prefs}
          speed={speed}
          onQuality={changeQuality}
          onSpeed={changeSpeed}
          onFit={(fit) => savePrefs({ fit })}
          onStats={(on) => savePrefs({ stats: on })}
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
