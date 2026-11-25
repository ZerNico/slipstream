import HlsJs, { ErrorTypes, Events, type ErrorData, type LevelLoadedData } from "hls.js";
import { useEffect, useRef, useState } from "react";
import {
  AT_LIVE_TOLERANCE,
  behindLive,
  clampToPlayable,
  type ClockAnchor,
  clockAnchors,
  livePoint,
  liveClock,
  mediaAt,
  type PlaybackSnapshot,
  wallAt,
} from "./live-position.ts";

/**
 * Where playback begins: the first captured second, hls.js's live point, a wall-clock moment
 * (a resume position on a running recording, a programme start) as epoch ms, or seconds after
 * the first captured second (a position in a finished recording).
 */
export type StartAt =
  | { readonly kind: "start" }
  | { readonly kind: "live" }
  | { readonly kind: "clock"; readonly at: number }
  | { readonly kind: "offset"; readonly seconds: number };

/** How loading the stream is going. */
export type PlaybackStatus = "loading" | "ready" | "failed" | "unsupported";

/** An audio or subtitle track the stream offers. */
export interface MediaTrack {
  readonly id: number;
  /** The playlist's name for it ("Deutsch", "English AD"), or its language code. */
  readonly name: string;
  readonly lang: string | undefined;
  /** Audio channels as the playlist declares them (6 for 5.1); undefined when it doesn't. */
  readonly channels: number | undefined;
}

/** How often the snapshot refreshes while nothing happens: live keeps growing while paused. */
const SAMPLE_MS = 1000;

/** A playlist or segment URL without its query: the same resource whatever token it carries. */
export const resourcePath = (url: string): string => {
  const parsed = new URL(url, window.location.href);
  return `${parsed.origin}${parsed.pathname}`;
};

/** Whether a load was refused for its token: 401 or 403 on a playlist or a segment. */
const refused = (data: ErrorData): boolean =>
  data.type === ErrorTypes.NETWORK_ERROR &&
  (data.response?.code === 401 || data.response?.code === 403);

/** The segment URLs of a media playlist, resolved against it. */
const segmentUrls = (playlist: string, base: string): string[] =>
  playlist
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => new URL(line, new URL(base, window.location.href)).href);

/** The playlist's stretches on the wall clock, from its PROGRAM-DATE-TIMEs. */
const anchorsOf = (data: LevelLoadedData): ClockAnchor[] =>
  clockAnchors(
    data.details.fragments.map((fragment) => ({
      start: fragment.start,
      duration: fragment.duration,
      programDateTime: fragment.programDateTime ?? null,
    })),
  );

/** What tells two clocks apart: each stretch's offset, to the millisecond. */
const clockKey = (anchors: readonly ClockAnchor[]): string =>
  anchors.map((anchor) => Math.round(anchor.wall - anchor.media * 1000)).join(",");

/** A start point as a media time, once the playable range and its clock are known. */
export const startMediaTime = (snapshot: PlaybackSnapshot, start: StartAt): number => {
  switch (start.kind) {
    case "start":
      return snapshot.seekableStart;
    case "live":
      return livePoint(snapshot);
    case "clock":
      return clampToPlayable(snapshot, mediaAt(snapshot, start.at));
    case "offset":
      return clampToPlayable(snapshot, snapshot.seekableStart + start.seconds);
  }
};

const trackOf = (track: {
  id: number;
  name: string;
  lang?: string | undefined;
  channels?: string | undefined;
}): MediaTrack => {
  const channels = track.channels === undefined ? Number.NaN : Number.parseInt(track.channels, 10);
  return {
    id: track.id,
    name: track.name || track.lang || "",
    lang: track.lang,
    channels: Number.isFinite(channels) ? channels : undefined,
  };
};

/**
 * Plays an HLS playlist (a growing EVENT playlist or a sliding live one) in a `<video>`, through
 * hls.js where Media Source Extensions exist and natively elsewhere (Safari). Returns the video
 * ref, a snapshot of where playback is relative to live, the tracks the stream offers and the
 * actions the controls need. The speed is a plain playback rate; at live it drops back to 1×
 * and `onReachedLive` says so.
 *
 * A new `src` for the same playlist (a renewed token: same path, a fresh query) is swapped in
 * without reloading anything, so the picture never blinks and live stays live: every later
 * request for that playlist, and for a finished playlist's segments, goes out with the fresh
 * URL. A playlist or segment refused with 401/403 asks `renew` for a fresh URL and retries
 * once; refused again, playback fails. A `src` for another playlist loads it and continues at
 * the same moment.
 */
export function useHlsPlayback(
  src: string | undefined,
  start: StartAt,
  options: {
    /** Called when playing faster than real time reached live and the speed went back to 1×. */
    readonly onReachedLive?: () => void;
    /** Renews the playlist token: the fresh playlist URL, or undefined when that failed. */
    readonly renew?: () => Promise<string | undefined>;
  } = {},
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsJs | null>(null);
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot | null>(null);
  const [paused, setPaused] = useState(true);
  const [rate, setRateState] = useState(1);
  const [status, setStatus] = useState<PlaybackStatus>("loading");
  const [ended, setEnded] = useState(false);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | undefined>(
    undefined,
  );
  const [audioTracks, setAudioTracks] = useState<readonly MediaTrack[]>([]);
  const [audioTrack, setAudioTrackState] = useState<number | undefined>(undefined);
  const [subtitleTracks, setSubtitleTracks] = useState<readonly MediaTrack[]>([]);
  const [subtitleTrack, setSubtitleTrackState] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  // Read when a load starts, so seeking later never reloads the stream.
  const startRef = useRef(start);
  // Where the last load got to, as a wall-clock time, so a new src continues there.
  const continueRef = useRef<number | null>(null);
  const reachedLiveRef = useRef(options.onReachedLive);
  const renewRef = useRef(options.renew);
  const rateRef = useRef(1);
  // The URL to load, read when a load starts; a renewed one is swapped in by `swapRef`.
  const srcRef = useRef(src);
  // The URL the current load uses (its first, or the last swapped in).
  const appliedRef = useRef<string | undefined>(undefined);
  // Swaps a renewed URL of the same playlist into the running load; set while one runs.
  const swapRef = useRef<((next: string) => Promise<void>) | null>(null);
  useEffect(() => {
    startRef.current = start;
    reachedLiveRef.current = options.onReachedLive;
    renewRef.current = options.renew;
    srcRef.current = src;
  });
  // Only another playlist reloads; a renewed token of the same one is swapped in (below).
  const playlist = src === undefined ? undefined : resourcePath(src);

  useEffect(() => {
    const video = videoRef.current;
    const first = srcRef.current;
    if (!video || first === undefined) return;
    appliedRef.current = first;
    let closed = false;
    let anchors: readonly ClockAnchor[] = [];
    let clock: Pick<PlaybackSnapshot, "epochOffset" | "clock"> | null = null;
    const continueAt = continueRef.current;
    let pending: StartAt | null =
      continueAt === null ? startRef.current : { kind: "clock", at: continueAt };

    const sample = () => {
      const { seekable } = video;
      if (seekable.length === 0) return;
      const seekableEnd = seekable.end(seekable.length - 1);
      clock ??= liveClock({ anchors, seekableEnd, now: Date.now() });
      const next: PlaybackSnapshot = {
        currentTime: video.currentTime,
        seekableStart: seekable.start(0),
        seekableEnd,
        liveSync: hlsRef.current?.liveSyncPosition ?? null,
        ...clock,
      };
      if (pending !== null) {
        video.currentTime = startMediaTime(next, pending);
        pending = null;
      }
      // Faster than real time ends where live is; nobody wants to be ahead of it.
      if (video.playbackRate > 1 && behindLive(next) <= AT_LIVE_TOLERANCE && !video.ended) {
        const growing = hlsRef.current?.latestLevelDetails?.live ?? true;
        if (growing) {
          video.playbackRate = 1;
          rateRef.current = 1;
          reachedLiveRef.current?.();
        }
      }
      continueRef.current = wallAt(next, video.currentTime);
      setSnapshot({ ...next, currentTime: video.currentTime });
      setPaused(video.paused);
      setEnded(video.ended);
      setRateState(video.playbackRate);
      setVideoSize((current) =>
        video.videoHeight <= 0
          ? undefined
          : current?.width === video.videoWidth && current.height === video.videoHeight
            ? current
            : { width: video.videoWidth, height: video.videoHeight },
      );
      setStatus("ready");
    };

    const autoplay = () => {
      video.playbackRate = rateRef.current;
      video.play().catch(() => setPaused(true));
    };

    const events = [
      "timeupdate",
      "progress",
      "durationchange",
      "play",
      "pause",
      "seeked",
      "ratechange",
      "ended",
      "loadedmetadata",
    ];
    for (const event of events) video.addEventListener(event, sample);
    const timer = window.setInterval(sample, SAMPLE_MS);

    let hls: HlsJs | null = null;
    // hls.js's types declare isSupported on the class only, not as the named export.
    // oxlint-disable-next-line import/no-named-as-default-member
    if (HlsJs.isSupported()) {
      // The freshest signed URL of each resource, by path: requests go out with it, so a renewed
      // token reaches playlist reloads and segments without reloading the stream.
      const signed = new Map<string, string>();
      hls = new HlsJs({
        startPosition: pending?.kind === "live" ? -1 : 0,
        liveDurationInfinity: true,
        xhrSetup: (xhr, url) => {
          const fresh = signed.get(resourcePath(url));
          if (fresh !== undefined && fresh !== url) xhr.open("GET", fresh, true);
        },
      });
      hlsRef.current = hls;
      const live = hls;
      let recovered = false;
      // One renew-and-retry per refusal; a segment that loads allows the next one.
      let renewed = false;
      let applying: { readonly url: string; readonly done: Promise<void> } | undefined;
      // A growing playlist brings fresh segment URLs with its next reload; a finished one is
      // never reloaded, so its segments' fresh URLs are read from the renewed playlist.
      const apply = (next: string): Promise<void> => {
        if (applying?.url === next) return applying.done;
        signed.set(resourcePath(next), new URL(next, window.location.href).href);
        const done =
          live.latestLevelDetails?.live === false
            ? fetch(next)
                .then((response) => (response.ok ? response.text() : ""))
                .then((text) => {
                  for (const url of segmentUrls(text, next)) signed.set(resourcePath(url), url);
                })
                .catch(() => {})
            : Promise.resolve();
        applying = { url: next, done };
        appliedRef.current = next;
        return done;
      };
      swapRef.current = apply;
      const fail = () => {
        setStatus("failed");
        live.destroy();
        hlsRef.current = null;
        swapRef.current = null;
      };
      live.on(Events.FRAG_LOADED, () => {
        renewed = false;
      });
      live.on(Events.LEVEL_LOADED, (_event, data) => {
        const next = anchorsOf(data);
        if (clockKey(next) !== clockKey(anchors)) {
          anchors = next;
          clock = null;
        } else {
          // Same stretches; the window slid, so keep the newest anchors.
          anchors = next;
          if (clock?.clock !== undefined) clock = { ...clock, clock: next };
        }
      });
      live.on(Events.MANIFEST_PARSED, autoplay);
      live.on(Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        setAudioTracks(data.audioTracks.map(trackOf));
        setAudioTrackState(live.audioTrack);
      });
      live.on(Events.AUDIO_TRACK_SWITCHED, (_event, data) => setAudioTrackState(data.id));
      live.on(Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
        setSubtitleTracks(data.subtitleTracks.map(trackOf));
      });
      live.on(Events.SUBTITLE_TRACK_SWITCH, (_event, data) => setSubtitleTrackState(data.id));
      live.on(Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal) return;
        // A decode hiccup usually recovers once; anything else is reported.
        if (data.type === ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          live.recoverMediaError();
          return;
        }
        // A refused token: renew it and retry once, from where playback is.
        const renew = renewRef.current;
        if (refused(data) && !renewed && renew !== undefined) {
          renewed = true;
          void renew()
            .then(async (next) => {
              if (closed) return;
              if (next === undefined) return fail();
              await apply(next);
              if (closed) return;
              // Without a parsed playlist there is nothing to resume: load it afresh.
              if (live.levels.length === 0) live.loadSource(next);
              else live.startLoad();
            })
            .catch(fail);
          return;
        }
        fail();
      });
      live.loadSource(first);
      live.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      const fail = () => setStatus("failed");
      video.addEventListener("loadedmetadata", autoplay, { once: true });
      video.addEventListener("error", fail, { once: true });
      video.src = first;
      // Native HLS reads its URL once: a renewed one is loaded and continues where playback
      // was, playing or paused as it was.
      swapRef.current = (next) => {
        appliedRef.current = next;
        const at = continueRef.current;
        if (at !== null) pending = { kind: "clock", at };
        if (!video.paused) video.addEventListener("loadedmetadata", autoplay, { once: true });
        video.src = next;
        return Promise.resolve();
      };
    } else {
      setStatus("unsupported");
    }

    return () => {
      closed = true;
      swapRef.current = null;
      window.clearInterval(timer);
      for (const event of events) video.removeEventListener(event, sample);
      hls?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
      setSnapshot(null);
      setStatus("loading");
    };
    // Keyed by the playlist, not its URL: a renewed token is swapped in below. `attempt` is the
    // Try again counter: a new value loads the same source afresh.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [playlist, attempt]);

  // A renewed URL of the playing playlist: swapped into the running load, nothing reloads.
  useEffect(() => {
    if (src === undefined || src === appliedRef.current) return;
    void swapRef.current?.(src);
  }, [src]);

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video || !snapshot) return;
    video.currentTime = clampToPlayable(snapshot, time);
    setSnapshot({ ...snapshot, currentTime: video.currentTime });
  };

  const play = () => {
    videoRef.current?.play().catch(() => setPaused(true));
  };

  return {
    videoRef,
    snapshot,
    paused,
    ended,
    rate,
    status,
    /** The decoded picture's size, once the first frame is known. */
    videoSize,
    audioTracks,
    audioTrack,
    subtitleTracks,
    subtitleTrack,
    seekTo,
    seekBy: (seconds: number) => {
      if (snapshot) seekTo(snapshot.currentTime + seconds);
    },
    play,
    togglePlay: () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) play();
      else video.pause();
    },
    /** Sets the playback rate; it is kept across a reload (another quality). */
    setRate: (next: number) => {
      rateRef.current = next;
      const video = videoRef.current;
      if (video) video.playbackRate = next;
      setRateState(next);
    },
    /** Applies this device's volume (0 to 100) and mute to the video element. */
    applyVolume: (volume: number, muted: boolean) => {
      const video = videoRef.current;
      if (!video) return;
      video.volume = Math.min(1, Math.max(0, volume / 100));
      video.muted = muted;
    },
    setAudioTrack: (id: number) => {
      if (hlsRef.current) hlsRef.current.audioTrack = id;
      setAudioTrackState(id);
    },
    /** Shows a subtitle track, or none with -1. */
    setSubtitleTrack: (id: number) => {
      if (hlsRef.current) {
        hlsRef.current.subtitleDisplay = id !== -1;
        hlsRef.current.subtitleTrack = id;
      }
      setSubtitleTrackState(id);
    },
    /** Loads the stream again from where it was (Try again). */
    retry: () => setAttempt((count) => count + 1),
    /** What the playback stats overlay shows, read on demand. */
    readStats: (): PlaybackStats => {
      const video = videoRef.current;
      const hls = hlsRef.current;
      let bufferSeconds: number | undefined;
      if (video) {
        for (let index = 0; index < video.buffered.length; index += 1) {
          const from = video.buffered.start(index);
          const to = video.buffered.end(index);
          if (from <= video.currentTime && to >= video.currentTime) {
            bufferSeconds = to - video.currentTime;
          }
        }
      }
      const quality = video?.getVideoPlaybackQuality?.();
      const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : undefined;
      const codecs = [level?.videoCodec, level?.audioCodec].filter(Boolean).join(", ");
      return {
        bufferSeconds,
        networkKbps:
          hls && Number.isFinite(hls.bandwidthEstimate)
            ? Math.round(hls.bandwidthEstimate / 1000)
            : undefined,
        streamKbps: level?.bitrate ? Math.round(level.bitrate / 1000) : undefined,
        codecs: codecs === "" ? undefined : codecs,
        droppedFrames: quality?.droppedVideoFrames,
        totalFrames: quality?.totalVideoFrames,
      };
    },
  };
}

/** A moment's playback numbers, for the stats overlay. */
export interface PlaybackStats {
  /** Seconds buffered ahead of the playhead. */
  readonly bufferSeconds: number | undefined;
  /** hls.js's estimate of the network's speed. */
  readonly networkKbps: number | undefined;
  /** The bitrate of the variant playing. */
  readonly streamKbps: number | undefined;
  /** "avc1.640028, mp4a.40.2". */
  readonly codecs: string | undefined;
  readonly droppedFrames: number | undefined;
  readonly totalFrames: number | undefined;
}
