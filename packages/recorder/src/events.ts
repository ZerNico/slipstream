/**
 * Status events the recorder emits (bridged into the database and SSE by the server). Every
 * reason is a typed {@link CaptureReason} from the domain, never prose: clients render the words.
 */
import {
  CaptureError,
  CaptureId,
  CaptureReason,
  CaptureState,
  ChannelId,
  Instant,
  RecordingId,
  RecordingState,
  RerunState,
  SourceId,
  SourceStreamId,
  StreamInfo,
  TimeRange,
} from "@slipstream/domain";
import { LogLevel, RunCounters } from "./capture/model.ts";
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect";

const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

/** Everything the recorder reports while it works. */
export const RecorderEvent = Schema.TaggedUnion({
  RecordingStarted: { recordingId: RecordingId, channelId: ChannelId, at: Instant },
  RecordingGap: { recordingId: RecordingId, range: TimeRange, reason: CaptureReason },
  RecordingFailed: { recordingId: RecordingId, reason: CaptureReason, at: Instant },
  RecordingEnded: {
    recordingId: RecordingId,
    state: RecordingState,
    at: Instant,
    reason: Schema.optionalKey(CaptureReason),
    /** Set when it ended needing a repeat: where its search for one stands (`looking` at first). */
    rerun: Schema.optionalKey(RerunState),
  },
  /** A good repeat (`id`) replaced the damaged recording `replacedId`, now hidden (§3.7). */
  RecordingReplaced: { id: RecordingId, replacedId: RecordingId },
  /**
   * A capture run changed state, in the domain's `CaptureState` words. Every `starting` opens a
   * new run on one source stream, so a listener can record each run (even one the source refuses
   * at once) from its first event; `stopped` and `failed` close it, `failed` with the error.
   */
  CaptureChanged: {
    channelId: ChannelId,
    state: CaptureState,
    captureId: CaptureId,
    directory: Schema.String,
    sourceId: SourceId,
    sourceStreamId: SourceStreamId,
    reason: Schema.optionalKey(CaptureReason),
    error: Schema.optionalKey(CaptureError),
  },
  /**
   * The channel has no stream right now and belongs to no run: it waits for a free stream and
   * opens a new run (`CaptureChanged` `starting`) when one frees.
   */
  CaptureUnavailable: { channelId: ChannelId, reason: CaptureReason },
  /** A line ffmpeg printed (warnings and errors), in its own words with credentials redacted. */
  CaptureLog: {
    channelId: ChannelId,
    captureId: CaptureId,
    runId: Schema.String,
    level: LogLevel,
    message: Schema.String,
  },
  /** Running numbers of a capture's current ffmpeg run. */
  CaptureStats: { channelId: ChannelId, captureId: CaptureId, stats: RunCounters },
  /** What ffmpeg found in the stream when a run started. */
  CaptureStreamDetected: {
    channelId: ChannelId,
    captureId: CaptureId,
    runId: Schema.String,
    info: StreamInfo,
  },
  /** The provider refused a run's stream: every stream it allows is busy. */
  SourceRefused: {
    channelId: ChannelId,
    captureId: CaptureId,
    sourceId: SourceId,
    sourceStreamId: SourceStreamId,
    httpStatus: Schema.optionalKey(Schema.Int),
  },
  /** A consumer of a running capture lost its stream to a recording. */
  ConsumerPreempted: {
    channelId: ChannelId,
    captureId: CaptureId,
    consumerId: Schema.String,
    reason: CaptureReason,
  },
  DiskSpaceLow: { freeBytes: NonNegative, floorBytes: NonNegative },
  DiskSpaceRecovered: { freeBytes: NonNegative },
  RetentionSwept: {
    recordingIds: Schema.Array(RecordingId),
    segments: NonNegative,
    bytes: NonNegative,
  },
}).annotate({ identifier: "RecorderEvent" });
export type RecorderEvent = typeof RecorderEvent.Type;

/** The recorder's event bus. Subscribers see events from the moment they subscribe. */
export class RecorderEvents extends Context.Service<
  RecorderEvents,
  {
    publish(event: RecorderEvent): Effect.Effect<void>;
    /** Live events from the moment the stream starts. */
    readonly events: Stream.Stream<RecorderEvent>;
  }
>()("@slipstream/recorder/RecorderEvents") {
  static readonly layer = Layer.effect(
    RecorderEvents,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<RecorderEvent>();
      return RecorderEvents.of({
        publish: (event) => Effect.asVoid(PubSub.publish(pubsub, event)),
        events: Stream.fromPubSub(pubsub),
      });
    }),
  );
}
