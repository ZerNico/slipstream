import { Schema } from "effect";

/** An ffmpeg or ffprobe binary could not be started at all. */
export class BinaryNotFound extends Schema.TaggedError<BinaryNotFound>()("BinaryNotFound", {
  binary: Schema.String,
  message: Schema.String,
}) {}

/** A short-lived ffmpeg/ffprobe invocation exited unsuccessfully. */
export class ProcessFailed extends Schema.TaggedError<ProcessFailed>()("ProcessFailed", {
  binary: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  /** The tail of stderr, in ffmpeg's own words. */
  stderr: Schema.String,
}) {}

/** ffprobe ran but its answer could not be understood. */
export class ProbeFailed extends Schema.TaggedError<ProbeFailed>()("ProbeFailed", {
  url: Schema.String,
  message: Schema.String,
}) {}

/** One startup self-check step did not pass. */
export class SelfCheckFailed extends Schema.TaggedError<SelfCheckFailed>()("SelfCheckFailed", {
  step: Schema.Literals(["version", "capture"]),
  message: Schema.String,
}) {}

/** A capture gave up: the reconnect schedule ran out while runs kept failing (no segment, or too short). */
export class CaptureFailed extends Schema.TaggedError<CaptureFailed>()("CaptureFailed", {
  captureId: Schema.String,
  /** Consecutive failed runs. */
  attempts: Schema.Int,
  lastError: Schema.NullOr(Schema.String),
}) {}
