/**
 * The capture engine: ffmpeg captures with their segment index and playlists (`capture/`), one
 * shared capture per channel, the recording scheduler, retention and the disk guard, over ports
 * the server implements. In-memory adapters for tests are under `@slipstream/recorder/testing`.
 */
export { Capture, type CaptureOptions, type ReconnectOptions } from "./capture/capture.ts";
export { siblingFfprobe } from "./capture/binaries.ts";
export {
  BinaryNotFound,
  CaptureFailed,
  ProbeFailed,
  ProcessFailed,
  SelfCheckFailed,
} from "./capture/errors.ts";
export { FfmpegConfig, type InputOptions } from "./capture/ffmpeg.ts";
export {
  CaptureEvent,
  CaptureRun,
  LogLevel,
  RunCounters,
  RunEndReason,
  Segment,
} from "./capture/model.ts";
export {
  discontinuities,
  GAP_TOLERANCE_MS,
  livePlaylist,
  recordingPlaylist,
  type LivePlaylistOptions,
  type PlaylistOptions,
  type RecordingPlaylistOptions,
} from "./capture/playlist.ts";
export { probe, type ProbeOptions } from "./capture/probe.ts";
export type { Completed } from "./capture/process.ts";
export { FfmpegRunner, type RunOptions } from "./capture/runner.ts";
export {
  ffmpegVersion,
  selfCheck,
  type SelfCheckOptions,
  type SelfCheckReport,
} from "./capture/self-check.ts";
export {
  CaptureManager,
  NoStreamAvailable,
  type CaptureLease,
  type CaptureManagerOptions,
  type ChannelEvent,
  type ChannelStatus,
  type Consumer,
  type ConsumerKind,
  type LiveWindow,
} from "./capture-manager.ts";
export { DiskGuard, type DiskGuardOptions, type DiskStatus } from "./disk-guard.ts";
export { RecorderEvent, RecorderEvents } from "./events.ts";
export {
  GuideRepo,
  HistoryRepo,
  Lineup,
  LiveKeepPolicy,
  PlanningContextRepo,
  RecordingRepo,
  RuleRepo,
  SegmentRepo,
  Storage,
  type ChannelLineup,
  type LineupSnapshot,
  type LiveKeepRules,
  type NewCapture,
  type PlanningAccess,
  type ServiceCandidate,
  type StoredRecording,
  type StoredSegment,
  type StreamCandidate,
} from "./ports.ts";
export {
  KeepOriginalReason,
  KeepOriginalRefused,
  keepOriginalUntil,
  RerunRecordingNotFound,
  Reruns,
} from "./reruns.ts";
export {
  expiredRecordings,
  RetentionPolicies,
  RetentionSweeper,
  type RetentionGroup,
  type SweepReport,
} from "./retention.ts";
export {
  ProgrammeNotFound,
  RecordingNotActive,
  RecordingNotFound,
  Scheduler,
  type RangeRequest,
  type SchedulerOptions,
} from "./scheduler.ts";
