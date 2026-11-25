import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  ChannelId,
  Instant,
  PlaybackSessionId,
  RecordingId,
  SourceId,
  StreamCounts,
  UserId,
} from "@slipstream/domain";
import { Forbidden, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/** One upstream stream in use: by a recording, or by someone watching live. */
export const StreamUse = Schema.TaggedUnion({
  Recording: { channelId: ChannelId, recordingId: RecordingId, since: Instant },
  Watching: {
    channelId: ChannelId,
    /** The playback session to stop ("Stop arte on Kitchen Shield"). */
    playbackSessionId: PlaybackSessionId,
    since: Instant,
    /** Absent for other people when the caller is a guest. */
    userId: Schema.optionalKey(UserId),
    /** "Kitchen Shield", "Pixel 9"; absent for browsers without a device name. */
    deviceName: Schema.optionalKey(Schema.String),
  },
}).annotate({ identifier: "StreamUse" });
export type StreamUse = typeof StreamUse.Type;

/**
 * One source's stream budget: "tvproxy allows 4 streams: 2 are kept for recordings, 2 for
 * watching" (SPEC 7.9). `streamHeadroom` in the domain turns the counts into free streams and
 * the at-limit state, the same way the server decides.
 */
export const SourceStreams = Schema.Struct({
  sourceId: SourceId,
  name: Schema.NonEmptyString,
  counts: StreamCounts,
  uses: Schema.Array(StreamUse),
}).annotate({ identifier: "SourceStreams" });
export type SourceStreams = typeof SourceStreams.Type;

/**
 * Streams: what the Server strip ("4 of 4 streams · 2 recording, 2 watching · 2 kept for
 * recordings"), Settings › Sources and the player's "No free stream for watching" error read.
 * Every signed-in profile may list them (the error names who watches); guests see other
 * people's uses without `userId`. Household profiles may stop any household viewer's stream,
 * guests only their own (`Forbidden`). Refetch on `ServerEvent.CaptureChanged`.
 */
export class StreamsGroup extends HttpApiGroup.make("streams")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(SourceStreams) }),
    HttpApiEndpoint.post("stopWatching", "/watching/:playbackSessionId/stop", {
      params: { playbackSessionId: PlaybackSessionId },
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/streams")
  .annotateMerge(OpenApi.annotations({ title: "Streams" })) {}
