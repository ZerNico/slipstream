/**
 * Pure parsers for what ffmpeg prints: `-loglevel level+info` stderr lines, the input summary
 * (container, codecs, resolution) and `-progress` key=value blocks.
 */
import type { ProbedAudio, ProbedStream, ProbedVideo } from "./model.ts";

/** One stderr line split into its parts. */
export interface LogLine {
  /** The component that printed it, such as `segment` or `http`; null for ffmpeg itself. */
  readonly component: string | null;
  readonly level: string;
  readonly message: string;
}

const LOG_LINE =
  /^(?:\[([^\]@]+?) @ 0x[0-9a-f]+\] )?\[(trace|debug|verbose|info|warning|error|fatal|panic)\] ?(.*)$/;

/** Parses a stderr line written with `-loglevel level+...`; other lines come back as info. */
export const parseLogLine = (line: string): LogLine => {
  const match = LOG_LINE.exec(line);
  if (!match) return { component: null, level: "info", message: line };
  return { component: match[1] ?? null, level: match[2] ?? "info", message: match[3] ?? "" };
};

/** Splits on ", " outside parentheses and brackets. */
const splitTopLevel = (text: string): Array<string> => {
  const parts: Array<string> = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && char === "," && text[i + 1] === " ") {
      parts.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
};

const CHANNEL_LAYOUTS: Record<string, number> = {
  mono: 1,
  stereo: 2,
  "2.1": 3,
  "3.0": 3,
  quad: 4,
  "4.0": 4,
  "5.0": 5,
  "5.1": 6,
  "6.1": 7,
  "7.1": 8,
};

const channelsOf = (layout: string): number | null => {
  const base = layout.replace(/\(.*\)$/, "");
  const known = CHANNEL_LAYOUTS[base];
  if (known !== undefined) return known;
  const counted = /^(\d+) channels/.exec(layout);
  return counted ? Number(counted[1]) : null;
};

const codecAndProfile = (part: string) => {
  const match = /^(\S+)(?: \(([^)[]+)\))?/.exec(part);
  return { codec: match?.[1] ?? part, profile: match?.[2] ?? null };
};

const STREAM_LINE =
  /^\s*Stream #(\d+):(\d+)(?:\[0x[0-9a-f]+\])?(?:\(([^)]+)\))?: (Video|Audio): (.*)$/;

/** A video or audio track parsed from an input summary `Stream #0:1...` line. */
export type ParsedTrack =
  | { readonly kind: "video"; readonly input: number; readonly track: ProbedVideo }
  | { readonly kind: "audio"; readonly input: number; readonly track: ProbedAudio };

/** Parses one `Stream #i:n: Video|Audio: ...` line from ffmpeg's summary; null for others. */
export const parseStreamLine = (message: string): ParsedTrack | null => {
  const match = STREAM_LINE.exec(message);
  if (!match) return null;
  const input = Number(match[1]);
  const index = Number(match[2]);
  const language = match[3] && match[3] !== "und" ? match[3] : null;
  const parts = splitTopLevel(match[5] ?? "");
  const { codec, profile } = codecAndProfile(parts[0] ?? "");
  const kbps = parts.map((part) => /^(\d+) kb\/s/.exec(part)).find((found) => found !== null);
  if (match[4] === "Audio") {
    const rate = parts.map((part) => /^(\d+) Hz$/.exec(part)).find((found) => found !== null);
    const layout = parts[2] ?? null;
    return {
      kind: "audio",
      input,
      track: {
        index,
        codec,
        profile,
        channels: layout ? channelsOf(layout) : null,
        channelLayout: layout,
        sampleRate: rate ? Number(rate[1]) : null,
        language,
        bitrate: kbps ? Number(kbps[1]) * 1000 : null,
      },
    };
  }
  const size = parts.map((part) => /^(\d+)x(\d+)/.exec(part)).find((found) => found !== null);
  const fps = parts.map((part) => /^([\d.]+) fps$/.exec(part)).find((found) => found !== null);
  const pixel = parts[1] && !/^\d+x\d+/.test(parts[1]) ? parts[1] : null;
  const pixelMatch = pixel ? /^([^(]+)(?:\((.*)\))?$/.exec(pixel) : null;
  const scan = pixelMatch?.[2] ?? "";
  const interlaced = /top first|bottom first|top coded first|bottom coded first/.test(scan)
    ? true
    : /progressive/.test(scan)
      ? false
      : null;
  return {
    kind: "video",
    input,
    track: {
      index,
      codec,
      profile,
      level: null,
      width: size ? Number(size[1]) : null,
      height: size ? Number(size[2]) : null,
      fps: fps ? Number(fps[1]) : null,
      interlaced,
      pixelFormat: pixelMatch?.[1]?.trim() ?? null,
    },
  };
};

/** Collects the first input's summary from successive stderr messages. */
export interface InputSummary {
  readonly phase: "before" | "input" | "done";
  readonly info: ProbedStream;
}

/** The summary before any stderr line has been seen. */
export const emptyInputSummary: InputSummary = {
  phase: "before",
  info: { container: null, bitrate: null, video: [], audio: [] },
};

/**
 * Feeds one stderr message into the summary. The phase turns `done` at `Stream mapping:` or the
 * first `Output #` line, which is when the info is complete.
 */
export const summarizeInput = (summary: InputSummary, message: string): InputSummary => {
  if (summary.phase === "done") return summary;
  const input = /^Input #0, ([^,]+), from/.exec(message);
  if (input) {
    return { phase: "input", info: { ...summary.info, container: input[1] ?? null } };
  }
  if (summary.phase !== "input") return summary;
  if (/^Stream mapping:|^Output #/.test(message)) return { ...summary, phase: "done" };
  const duration = /^\s*Duration: .*bitrate: (\d+) kb\/s/.exec(message);
  if (duration)
    return { ...summary, info: { ...summary.info, bitrate: Number(duration[1]) * 1000 } };
  const track = parseStreamLine(message);
  if (!track || track.input !== 0) return summary;
  return {
    ...summary,
    info:
      track.kind === "video"
        ? { ...summary.info, video: [...summary.info.video, track.track] }
        : { ...summary.info, audio: [...summary.info.audio, track.track] },
  };
};

/** One `-progress` report. */
export interface ProgressReport {
  readonly speed: number | null;
  readonly outTimeMs: number | null;
  readonly ended: boolean;
}

/**
 * Accumulates `-progress` key=value lines; returns a report when a block ends with `progress=`.
 * `pending` is the mutable buffer for the current block.
 */
export const feedProgressLine = (
  pending: Map<string, string>,
  line: string,
): ProgressReport | null => {
  const eq = line.indexOf("=");
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();
  if (key !== "progress") {
    pending.set(key, value);
    return null;
  }
  const speed = Number.parseFloat(pending.get("speed") ?? "");
  const outUs = Number.parseInt(pending.get("out_time_us") ?? "", 10);
  pending.clear();
  return {
    speed: Number.isFinite(speed) ? speed : null,
    outTimeMs: Number.isFinite(outUs) ? Math.round(outUs / 1000) : null,
    ended: value === "end",
  };
};
