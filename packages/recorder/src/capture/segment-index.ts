/**
 * Turns ffmpeg segment-list entries into indexed segments with wall-clock times.
 *
 * ffmpeg's csv segment list gives each segment's media start and end in seconds since the run's
 * first packet. A run is anchored to the wall clock once, when its first entry is seen
 * (`observedAt - end`), and every later segment in the run is placed by media time from that
 * anchor, so times stay contiguous and never drift. A jump in media time re-anchors the run.
 *
 * Limitation: an upstream that bursts buffered media on connect (faster than real time) shifts
 * the whole run later by the size of the burst, because the first segment is indexed right away
 * instead of waiting to see how far behind live the upstream really is. ffmpeg's own HLS
 * `program_date_time` has the same property.
 */
import type { Segment } from "./model.ts";

/** One line of a `-segment_list_type csv` list. */
export interface ListEntry {
  readonly file: string;
  readonly startSec: number;
  readonly endSec: number;
}

/** Parses `file,start,end` (ffmpeg quotes the file name when it contains a comma or quote). */
export const parseListLine = (line: string): ListEntry | null => {
  const match = /^(?:"((?:[^"]|"")*)"|([^,]*)),([^,]+),([^,]+)$/.exec(line.trim());
  if (!match) return null;
  const file = match[1] === undefined ? match[2] : match[1].replaceAll('""', '"');
  const startSec = Number(match[3]);
  const endSec = Number(match[4]);
  if (!file || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) {
    return null;
  }
  return { file, startSec, endSec };
};

/** Indexing state for one capture; reset `anchorMs` and `lastEndSec` per run. */
export interface IndexState {
  readonly captureId: string;
  readonly runId: string;
  readonly nextSequence: number;
  /** Wall-clock time of media time zero in the current run. */
  readonly anchorMs: number | null;
  readonly lastEndSec: number | null;
  /** Where the previous segment of the capture ended (epoch ms), across runs. */
  readonly previousEndMs: number | null;
}

/** Media time jumps larger than this inside one run re-anchor the run. */
const MEDIA_JUMP_SEC = 1;

/** State for the first run of a capture. */
export const initialIndexState = (captureId: string, runId: string): IndexState => ({
  captureId,
  runId,
  nextSequence: 0,
  anchorMs: null,
  lastEndSec: null,
  previousEndMs: null,
});

/** Starts a new run, keeping the sequence counter and where the last segment ended. */
export const startRun = (state: IndexState, runId: string): IndexState => ({
  ...state,
  runId,
  anchorMs: null,
  lastEndSec: null,
});

/** Result of indexing one entry. */
export interface Indexed {
  readonly state: IndexState;
  readonly segment: Segment;
}

/**
 * Indexes one finished segment. `observedAtMs` is when the list line was read and `path` is the
 * segment's path relative to the capture directory.
 */
export const indexEntry = (
  state: IndexState,
  entry: ListEntry,
  observedAtMs: number,
  bytes: number,
  path: string,
): Indexed => {
  const jumped =
    state.lastEndSec !== null && Math.abs(entry.startSec - state.lastEndSec) > MEDIA_JUMP_SEC;
  let anchorMs =
    state.anchorMs === null || jumped ? observedAtMs - entry.endSec * 1000 : state.anchorMs;
  let startMs = Math.round(anchorMs + entry.startSec * 1000);
  // Upstreams can replay buffered media after a reconnect; never overlap what is indexed.
  if (state.previousEndMs !== null && startMs < state.previousEndMs) {
    anchorMs += state.previousEndMs - startMs;
    startMs = state.previousEndMs;
  }
  const durationMs = Math.round((entry.endSec - entry.startSec) * 1000);
  const segment: Segment = {
    captureId: state.captureId,
    runId: state.runId,
    sequence: state.nextSequence,
    startMs,
    durationMs,
    bytes,
    path,
  };
  return {
    state: {
      ...state,
      nextSequence: state.nextSequence + 1,
      anchorMs,
      lastEndSec: entry.endSec,
      previousEndMs: startMs + durationMs,
    },
    segment,
  };
};
