/**
 * Pure HLS media playlist generation from a slice of the segment index.
 *
 * - Live: a sliding window over the newest segments, as long as the DVR window.
 * - Recording while running: an EVENT playlist from the range start that grows.
 * - Recording finished: a VOD playlist with `#EXT-X-ENDLIST`.
 *
 * A run boundary or a hole in wall-clock time gets `#EXT-X-DISCONTINUITY`, and every segment
 * carries `#EXT-X-PROGRAM-DATE-TIME` so players and the UI can map positions to wall-clock time.
 */
import type { Segment } from "./model.ts";

/**
 * Holes in wall-clock time up to this long are jitter, not gaps. The one tolerance for playlist
 * discontinuities (here and in the server's live playlists) and the capture manager's `Gap`
 * events, so a hole a viewer sees as a break is also the one a recording reports.
 */
export const GAP_TOLERANCE_MS = 1000;

/** Options shared by every playlist kind. */
export interface PlaylistOptions {
  /** Segment URI as the player should request it. Default: the segment's `path`. */
  readonly segmentUri?: (segment: Segment) => string;
  /** Holes in wall-clock time longer than this become discontinuities. Default {@link GAP_TOLERANCE_MS}. */
  readonly gapToleranceMs?: number;
}

/** Options for {@link livePlaylist}. */
export interface LivePlaylistOptions extends PlaylistOptions {
  /** How far behind the live edge a viewer may seek, in milliseconds. */
  readonly dvrWindowMs: number;
  /** Keep at least this many segments even when the window is shorter. Default 3. */
  readonly minSegments?: number;
}

/** Options for {@link recordingPlaylist}. */
export interface RecordingPlaylistOptions extends PlaylistOptions {
  /** Range start, epoch ms. */
  readonly fromMs: number;
  /** Range end, epoch ms. */
  readonly toMs: number;
  /** True once the range has ended and is fully written: emits VOD with `#EXT-X-ENDLIST`. */
  readonly complete: boolean;
  /** Ask players to start at the first segment instead of the live edge. Default true. */
  readonly startAtBeginning?: boolean;
}

const endOf = (segment: Segment) => segment.startMs + segment.durationMs;

/**
 * Marks which segments start after a discontinuity: a different run than the previous segment,
 * or a hole (or overlap) in wall-clock time beyond the tolerance. The first segment is never
 * marked.
 */
export const discontinuities = (
  segments: ReadonlyArray<Segment>,
  gapToleranceMs: number = GAP_TOLERANCE_MS,
): ReadonlyArray<boolean> =>
  segments.map((segment, i) => {
    const previous = segments[i - 1];
    if (!previous) return false;
    return (
      previous.runId !== segment.runId ||
      Math.abs(segment.startMs - endOf(previous)) > gapToleranceMs
    );
  });

/** Segments that overlap the half-open range `[fromMs, toMs)`, in index order. */
export const segmentsInRange = (
  segments: ReadonlyArray<Segment>,
  fromMs: number,
  toMs: number,
): ReadonlyArray<Segment> =>
  segments.filter((segment) => segment.startMs < toMs && endOf(segment) > fromMs);

interface RenderInput {
  readonly segments: ReadonlyArray<Segment>;
  readonly breaks: ReadonlyArray<boolean>;
  readonly playlistType: "EVENT" | "VOD" | null;
  readonly discontinuitySequence: number;
  readonly startAtBeginning: boolean;
  readonly options: PlaylistOptions;
}

const seconds = (ms: number) => (ms / 1000).toFixed(3);

const render = (input: RenderInput): string => {
  const uri = input.options.segmentUri ?? ((segment: Segment) => segment.path);
  const maxDuration = Math.max(0, ...input.segments.map((segment) => segment.durationMs));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(maxDuration / 1000))}`,
    `#EXT-X-MEDIA-SEQUENCE:${input.segments[0]?.sequence ?? 0}`,
  ];
  if (input.playlistType === null || input.discontinuitySequence > 0) {
    lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${input.discontinuitySequence}`);
  }
  if (input.playlistType) lines.push(`#EXT-X-PLAYLIST-TYPE:${input.playlistType}`);
  if (input.startAtBeginning) lines.push("#EXT-X-START:TIME-OFFSET=0,PRECISE=YES");
  input.segments.forEach((segment, i) => {
    // A tag on the first segment would be counted twice: it is already in the sequence number.
    if (i > 0 && input.breaks[i]) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(segment.startMs).toISOString()}`);
    lines.push(`#EXTINF:${seconds(segment.durationMs)},`);
    lines.push(uri(segment));
  });
  if (input.playlistType === "VOD") lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
};

/**
 * Live sliding playlist: the newest segments covering `dvrWindowMs` back from the live edge.
 * Pass every indexed segment of the capture, oldest first, so the media and discontinuity
 * sequence numbers stay stable while the window slides.
 */
export const livePlaylist = (
  segments: ReadonlyArray<Segment>,
  options: LivePlaylistOptions,
): string => {
  const breaks = discontinuities(segments, options.gapToleranceMs);
  const last = segments.at(-1);
  const minSegments = options.minSegments ?? 3;
  let first = segments.length;
  if (last) {
    const edge = endOf(last);
    first = segments.findIndex((segment) => endOf(segment) > edge - options.dvrWindowMs);
    first = Math.min(
      first === -1 ? segments.length : first,
      Math.max(0, segments.length - minSegments),
    );
  }
  const discontinuitySequence = breaks.slice(0, first + 1).filter(Boolean).length;
  return render({
    segments: segments.slice(first),
    breaks: breaks.slice(first),
    playlistType: null,
    discontinuitySequence,
    startAtBeginning: false,
    options,
  });
};

/**
 * Playlist for a recording range: EVENT while it is still being written (players can seek
 * anywhere from the start while it grows), VOD with `#EXT-X-ENDLIST` once `complete`.
 * Pass the capture's segments; only those overlapping the range are used.
 */
export const recordingPlaylist = (
  segments: ReadonlyArray<Segment>,
  options: RecordingPlaylistOptions,
): string => {
  const slice = segmentsInRange(segments, options.fromMs, options.toMs);
  return render({
    segments: slice,
    breaks: discontinuities(slice, options.gapToleranceMs),
    playlistType: options.complete ? "VOD" : "EVENT",
    discontinuitySequence: 0,
    startAtBeginning: options.startAtBeginning ?? true,
    options,
  });
};
