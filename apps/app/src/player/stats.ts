import { deliveryOf, type TranscodePlan } from "@slipstream/domain";
import { deliveryText, m } from "@slipstream/i18n";

/*
 * The player's playback stats (Options › Playback stats), the web's overlay: the picture, its
 * codecs, how the server delivers it, the bitrates and the buffer. Media3 reports no dropped
 * frames through react-native-video, so that row stays the web's.
 */

/** A video track as react-native-video reports it (`onVideoTracks`). */
export interface StatsVideoTrack {
  readonly codecs?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  /** Bits per second. */
  readonly bitrate?: number | undefined;
  readonly selected?: boolean | undefined;
}

/** What the stats read at one moment. */
export interface StatsSample {
  /** The picture's size as decoded (`onLoad`'s natural size). */
  readonly videoSize: { readonly width: number; readonly height: number } | undefined;
  readonly tracks: readonly StatsVideoTrack[];
  /** The session's plan: how the server delivers the stream. */
  readonly plan: TranscodePlan | undefined;
  /** The player's bandwidth estimate, bits per second (`onBandwidthUpdate`). */
  readonly networkBitrate: number | undefined;
  /** Where playback is and how far the player has loaded, in seconds (`onProgress`). */
  readonly position:
    | { readonly currentTime: number; readonly playableDuration: number }
    | undefined;
}

/** One line of the stats: its label and its value. */
export type StatsRow = readonly [label: string, value: string];

const positive = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;

/** The track playing: the selected one, else the only one. */
const playingTrack = (tracks: readonly StatsVideoTrack[]): StatsVideoTrack | undefined =>
  tracks.find((track) => track.selected === true) ?? (tracks.length === 1 ? tracks[0] : undefined);

/** Seconds loaded ahead of the playhead, never below zero. */
const bufferAhead = (position: StatsSample["position"]): number | undefined => {
  if (position === undefined || !Number.isFinite(position.playableDuration)) return undefined;
  return Math.max(0, position.playableDuration - position.currentTime);
};

/** The rows the stats show, in the web's order; what the player does not know stays out. */
export const statsRows = (sample: StatsSample): readonly StatsRow[] => {
  const track = playingTrack(sample.tracks);
  const width = positive(sample.videoSize?.width) ?? positive(track?.width);
  const height = positive(sample.videoSize?.height) ?? positive(track?.height);
  const rows: StatsRow[] = [];
  if (width !== undefined && height !== undefined) {
    rows.push([m.player_details_video(), m.player_details_size({ width, height })]);
  }
  if (track?.codecs !== undefined && track.codecs.length > 0) {
    rows.push([m.player_stats_codecs(), track.codecs]);
  }
  rows.push([m.player_stats_delivery(), deliveryText(deliveryOf(sample.plan))]);
  const stream = positive(track?.bitrate);
  if (stream !== undefined) {
    rows.push([m.player_stats_stream(), m.player_stats_kbps({ kbps: Math.round(stream / 1000) })]);
  }
  const network = positive(sample.networkBitrate);
  if (network !== undefined) {
    rows.push([
      m.player_stats_network(),
      m.player_stats_kbps({ kbps: Math.round(network / 1000) }),
    ]);
  }
  const buffer = bufferAhead(sample.position);
  if (buffer !== undefined) {
    rows.push([m.player_stats_buffer(), m.player_stats_seconds({ seconds: buffer })]);
  }
  return rows;
};
