/** ffmpeg binaries and the argument lists Slipstream runs them with. */
import { Context } from "effect";

/** Which ffmpeg and ffprobe binaries to run. Defaults to the ones on PATH. */
export const FfmpegConfig = Context.Reference<{
  readonly ffmpeg: string;
  readonly ffprobe: string;
}>("@slipstream/recorder/FfmpegConfig", {
  defaultValue: () => ({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" }),
});

/** How to reach an upstream stream. */
export interface InputOptions {
  readonly url: string;
  readonly userAgent?: string;
  /** Extra HTTP request headers, such as a referer or an auth token. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Network read/write timeout; ffmpeg gives up on a silent socket after this. Default 15 s. */
  readonly ioTimeoutMs?: number;
}

/**
 * The protocols an input with a URL scheme may open, nested opens included: HTTP(S) over TCP and
 * TLS, HLS playlists and AES-128 HLS keys (`crypto`). Upstream URLs come from provider
 * playlists, so anything else (`file:`, `concat:`, `subfile:`, `data:`, ...) is refused by ffmpeg
 * itself instead of reading local files. udp and rtp are left out: every supported source type
 * (M3U playlists) delivers over http(s), and the sources package drops other stream URLs.
 */
export const INPUT_PROTOCOLS = "http,https,tcp,tls,crypto,hls";

/** An input that names a protocol (`scheme:`) rather than a local path. */
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Input-side arguments shared by capture and probe, ending with `-i <url>`. Plain paths (the
 * self-check's test stream, files in tests) are read as they are.
 */
export const inputArgs = (input: InputOptions): Array<string> => {
  const args: Array<string> = [];
  if (SCHEME.test(input.url)) {
    args.push("-protocol_whitelist", INPUT_PROTOCOLS);
    args.push("-rw_timeout", String(Math.round((input.ioTimeoutMs ?? 15_000) * 1000)));
    if (input.userAgent) args.push("-user_agent", input.userAgent);
    const headers = Object.entries(input.headers ?? {});
    if (headers.length > 0) {
      args.push("-headers", headers.map(([name, value]) => `${name}: ${value}\r\n`).join(""));
    }
  }
  args.push("-i", input.url);
  return args;
};

/** Where and how a capture run writes its segments. */
export interface SegmentOutput {
  /** Target segment length; ffmpeg cuts at the next keyframe after it. */
  readonly segmentSeconds: number;
  /** csv segment list, relative to the working directory. */
  readonly listFile: string;
  /** Segment file pattern with one `%0Nd`, relative to the working directory. */
  readonly segmentPattern: string;
}

/**
 * The full capture command line: stream copy of every video and audio track into MPEG-TS
 * segments, a csv segment list that grows by one line per finished segment, and `-progress`
 * reports on stdout.
 */
export const captureArgs = (input: InputOptions, output: SegmentOutput): Array<string> => [
  "-hide_banner",
  "-nostdin",
  "-loglevel",
  "level+info",
  "-nostats",
  "-progress",
  "pipe:1",
  "-stats_period",
  "5",
  "-fflags",
  "+genpts+discardcorrupt",
  ...inputArgs(input),
  "-map",
  "0:v?",
  "-map",
  "0:a?",
  "-c",
  "copy",
  "-f",
  "segment",
  "-segment_format",
  "mpegts",
  "-segment_time",
  String(output.segmentSeconds),
  "-segment_list",
  output.listFile,
  "-segment_list_type",
  "csv",
  "-segment_start_number",
  "0",
  output.segmentPattern,
];

/** Options for {@link testSourceArgs}. */
export interface TestSourceOptions {
  /** Seconds of media to generate; omit for an endless source. */
  readonly durationSeconds?: number;
  /** Pace output at real time, like a live channel. */
  readonly realtime?: boolean;
  /** Keyframe interval in seconds. Default 1. */
  readonly keyframeSeconds?: number;
}

/**
 * A lavfi test pattern (testsrc2 with a sine tone) encoded to MPEG-TS with encoders built into
 * every ffmpeg (mpeg2video, mp2). The caller appends the output (`-f mpegts <target>`).
 */
export const testSourceArgs = (options: TestSourceOptions = {}): Array<string> => {
  const fps = 25;
  const duration =
    options.durationSeconds === undefined ? [] : ["-t", String(options.durationSeconds)];
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    ...(options.realtime ? ["-re"] : []),
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x180:rate=${fps}`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    ...duration,
    "-c:v",
    "mpeg2video",
    "-q:v",
    "8",
    "-g",
    String(Math.max(1, Math.round((options.keyframeSeconds ?? 1) * fps))),
    "-c:a",
    "mp2",
    "-b:a",
    "96k",
    "-f",
    "mpegts",
  ];
};
