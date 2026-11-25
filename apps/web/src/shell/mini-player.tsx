import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CloseIcon, FullscreenIcon, PauseIcon, PlayIcon } from "~/ui/icons.ts";
import { IconButton } from "~/ui/primitives/button.tsx";
import type { PlaybackSource } from "@slipstream/api";
import { ChannelId, qualityRequest, RecordingId } from "@slipstream/domain";
import type { PlaybackSnapshot } from "~/modules/watch/live-position.ts";
import { type StartAt, useHlsPlayback } from "~/modules/watch/use-hls-playback.ts";
import { usePlaybackSession } from "~/modules/watch/use-playback-session.ts";
import {
  type MiniPlayerItem,
  setMiniPlayerItem,
  SuppressContext,
  useMiniPlayerItem,
} from "./mini-player-store.ts";
import { useMiniPlacement } from "./mini-player-placement.ts";

/** Provides suppression to screens and renders the mini player when it applies. */
export function MiniPlayerHost({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const item = useMiniPlayerItem();
  const [suppressed, setSuppressed] = useState<readonly string[]>([]);
  const [register] = useState(() => (ids: readonly string[]) => {
    setSuppressed((current) => [...current, ...ids]);
    return () =>
      setSuppressed((current) => {
        const next = [...current];
        for (const id of ids) {
          const index = next.indexOf(id);
          if (index !== -1) next.splice(index, 1);
        }
        return next;
      });
  });
  const show = enabled && item !== null && !suppressed.includes(item.id);
  return (
    <SuppressContext value={register}>
      {children}
      {show ? <PlayingMiniPlayer key={item.id} item={item} /> : null}
    </SuppressContext>
  );
}

/** Where the playing mini player is, as the full player's `t`: position ms, or wall clock ms. */
const resumeOf = (
  item: Extract<MiniPlayerItem, { kind: "recording" }>,
  snapshot: PlaybackSnapshot | null,
): number =>
  snapshot === null
    ? item.resumeT
    : item.live
      ? Math.round(snapshot.epochOffset + snapshot.currentTime * 1000)
      : Math.round(Math.max(0, snapshot.currentTime - snapshot.seekableStart) * 1000);

/** What the mini player plays and where it starts. */
const playbackOf = (item: MiniPlayerItem): { source: PlaybackSource; start: StartAt } =>
  item.kind === "channel"
    ? { source: { _tag: "Live", channelId: ChannelId.make(item.id) }, start: { kind: "live" } }
    : {
        source: { _tag: "Recording", recordingId: RecordingId.make(item.id) },
        start: item.live
          ? { kind: "clock", at: item.resumeT }
          : { kind: "offset", seconds: item.resumeT / 1000 },
      };

/**
 * The mini player (SPEC §2.2): what you left playing keeps playing, in its own session from the
 * moment you left (a live channel at live). From 768 px a video card in the corner: hovering or
 * focusing it dims the picture and shows play/pause in the middle, open (top left) and close (top
 * right); a click anywhere else on the picture opens the full player there. On phones a bar with
 * the video as its thumbnail, the title opening the player, play/pause and close. Leaving the
 * player paused leaves nothing behind; Continue watching holds the place.
 */
function PlayingMiniPlayer({ item }: { item: MiniPlayerItem }) {
  const [playback] = useState(() => playbackOf(item));
  const session = usePlaybackSession(playback.source, qualityRequest("auto"));
  const { videoRef, snapshot, paused, togglePlay } = useHlsPlayback(
    session.session?.playlistUrl,
    playback.start,
    { renew: session.renew },
  );
  const t = item.kind === "recording" ? resumeOf(item, snapshot) : undefined;
  const remember = () => {
    if (item.kind === "recording" && t !== undefined) setMiniPlayerItem({ ...item, resumeT: t });
  };
  // Opening hands playback back to the full player, which closes the mini player.
  const open = (className: string, children: ReactNode, tabbable = true) =>
    item.kind === "channel" ? (
      <Link
        to="/watch/live/$channel"
        params={{ channel: item.id }}
        className={className}
        aria-label={m.mini_open()}
        tabIndex={tabbable ? undefined : -1}
        aria-hidden={tabbable ? undefined : true}
      >
        {children}
      </Link>
    ) : (
      <Link
        to="/watch/rec/$id"
        params={{ id: item.id }}
        search={{ at: "pos", t: t ?? item.resumeT }}
        className={className}
        aria-label={m.mini_open()}
        tabIndex={tabbable ? undefined : -1}
        aria-hidden={tabbable ? undefined : true}
        onClick={remember}
      >
        {children}
      </Link>
    );
  const { setCard, corner, dragging, style, cardProps, onResizeDown } = useMiniPlacement();
  const playPause = () => (
    <IconButton label={paused ? m.player_play() : m.player_pause()} onClick={togglePlay}>
      <Icon icon={paused ? PlayIcon : PauseIcon} />
    </IconButton>
  );
  return (
    <div
      ref={setCard}
      className="mini-player"
      data-mini-player=""
      data-surface="cine"
      data-corner={corner}
      data-dragging={dragging ? "" : undefined}
      style={style}
      role="region"
      aria-label={m.mini_label({ title: item.title })}
      {...cardProps}
    >
      {/* Desktop only: the inner corner widens or narrows the card. */}
      <span
        data-mini-resize=""
        className="mini-player-resize"
        aria-hidden="true"
        onPointerDown={onResizeDown}
      />
      <div className="mini-player-stage">
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- the full player has subtitles */}
        <video ref={videoRef} className="mini-player-video" playsInline />
        {/* The card's controls over the picture; phones use the bar's own buttons. */}
        <div className="mini-player-overlay">
          {open("mini-player-overlay-open", null, false)}
          {open("mini-player-expand", <Icon icon={FullscreenIcon} size={16} />)}
          <button
            type="button"
            className="mini-player-close"
            aria-label={m.action_close()}
            onClick={() => setMiniPlayerItem(null)}
          >
            <Icon icon={CloseIcon} size={16} />
          </button>
          <button
            type="button"
            className="mini-player-center"
            aria-label={paused ? m.player_play() : m.player_pause()}
            onClick={togglePlay}
          >
            <Icon icon={paused ? PlayIcon : PauseIcon} size={20} />
          </button>
        </div>
      </div>
      {open(
        "mini-player-open",
        <span className="mini-player-text">
          <b className="mini-player-title">{item.title}</b>
        </span>,
      )}
      <span className="mini-player-actions">
        {playPause()}
        <IconButton label={m.action_close()} onClick={() => setMiniPlayerItem(null)}>
          <Icon icon={CloseIcon} size={16} />
        </IconButton>
      </span>
    </div>
  );
}
