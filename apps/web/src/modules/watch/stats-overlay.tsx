import { useEffect, useRef, useState } from "react";
import type { PlaybackSession } from "@slipstream/api";
import { deliveryOf, type Encoder } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { cn } from "~/ui/utils.ts";
import { decisionText } from "./player-text.ts";
import type { PlaybackStats } from "./use-hls-playback.ts";

/** Encoder names as their makers write them; not words to translate. */
const encoderNames: Readonly<Record<Encoder, string>> = {
  software: "x264",
  qsv: "Intel Quick Sync",
  vaapi: "VA-API",
  nvenc: "NVENC",
};

/** How the server delivers the stream, with the encoder when it converts. */
const deliveryText = (session: PlaybackSession | undefined): string => {
  const { decision, encoder } = deliveryOf(session?.plan);
  if (decision === "direct") return m.player_stats_direct();
  const how = decisionText(decision);
  return encoder === undefined ? how : `${how} · ${encoderNames[encoder]}`;
};

/**
 * The opt-in playback statistics (Options › Playback stats): the picture, codecs, how it is
 * delivered, bitrates, the buffer and dropped frames, read once a second. Quiet, monospaced
 * figures in a glass box at the top left; it never takes clicks.
 */
export function StatsOverlay({
  read,
  session,
  videoSize,
  className,
}: {
  read: () => PlaybackStats;
  session: PlaybackSession | undefined;
  videoSize: { readonly width: number; readonly height: number } | undefined;
  className?: string;
}) {
  const [stats, setStats] = useState<PlaybackStats | undefined>(undefined);
  // The reader is a fresh function every render; the timer always calls the latest one.
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  useEffect(() => {
    const tick = () => setStats(reader.current());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (stats === undefined) return null;
  const rows: [string, string][] = [];
  if (videoSize) rows.push([m.player_details_video(), m.player_details_size(videoSize)]);
  if (stats.codecs) rows.push([m.player_stats_codecs(), stats.codecs]);
  rows.push([m.player_stats_delivery(), deliveryText(session)]);
  if (stats.streamKbps) {
    rows.push([m.player_stats_stream(), m.player_stats_kbps({ kbps: stats.streamKbps })]);
  }
  if (stats.networkKbps) {
    rows.push([m.player_stats_network(), m.player_stats_kbps({ kbps: stats.networkKbps })]);
  }
  if (stats.bufferSeconds !== undefined) {
    rows.push([m.player_stats_buffer(), m.player_stats_seconds({ seconds: stats.bufferSeconds })]);
  }
  if (stats.totalFrames !== undefined && stats.droppedFrames !== undefined) {
    rows.push([
      m.player_stats_dropped(),
      m.player_stats_frames({ dropped: stats.droppedFrames, total: stats.totalFrames }),
    ]);
  }
  return (
    <dl
      aria-label={m.player_stats()}
      data-stats=""
      className={cn(
        "pointer-events-none grid w-72 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-[14px] px-3.5 py-3 text-[12px] leading-snug",
        "bg-[color-mix(in_oklab,var(--sunken)_72%,transparent)] text-fg-2 shadow-pop backdrop-blur-xl",
        className,
      )}
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-3">{label}</dt>
          <dd className="truncate font-mono text-fg tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
