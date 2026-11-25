import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  Channel,
  ChannelId,
  Instant,
  MatchReason,
  SourceId,
  SourceStreamId,
  StreamQuality,
  SourceInput,
  SourceStreamView,
  SourceUpdate,
  SourceView,
} from "@slipstream/domain";
import { Forbidden, InvalidInput, NotFound, SourceFailed } from "../errors.ts";
import { Authentication } from "../security.ts";
import { ChannelRef } from "./channels.ts";

/** What a test or refresh found. */
export const SourceCheck = Schema.Struct({
  streams: Schema.Int,
  guideChannels: Schema.Int,
  programmes: Schema.Int,
  /** Streams whose tvg-id has no guide channel; the UI offers manual mapping. */
  unmappedStreams: Schema.Int,
  checkedAt: Instant,
}).annotate({ identifier: "SourceCheck" });
export type SourceCheck = typeof SourceCheck.Type;

/** The existing channel a stream that is not added looks like. */
export const StreamMatch = Schema.Struct({
  channelId: ChannelId,
  name: Schema.String,
  reason: MatchReason,
}).annotate({ identifier: "StreamMatch" });
export type StreamMatch = typeof StreamMatch.Type;

/** One stream of a source as the stream picker lists it (no URL: it may carry credentials). */
export const SourceStreamEntry = Schema.Struct({
  id: SourceStreamId,
  name: Schema.String,
  group: Schema.optionalKey(Schema.String),
  tvgId: Schema.optionalKey(Schema.String),
  logoUrl: Schema.optionalKey(Schema.String),
  /** The playlist's channel number (`tvg-chno`). */
  channelNumber: Schema.optionalKey(Schema.String),
  quality: StreamQuality,
  /** Higher is better: UHD 4, FHD 3, HD 2, SD 1, unknown 0. */
  qualityRank: Schema.Int,
  /** Whether the source's guide has the stream's tvg-id. */
  hasGuide: Schema.Boolean,
  /** The channel it is added to. */
  channel: Schema.optionalKey(ChannelRef),
  /** For a stream not added: the existing channel it looks like. */
  match: Schema.optionalKey(StreamMatch),
  /** First seen since the source was last reviewed, and neither added nor ignored. */
  new: Schema.Boolean,
  ignored: Schema.Boolean,
  /** The playlist no longer lists it (kept because a channel uses it). */
  gone: Schema.Boolean,
}).annotate({ identifier: "SourceStreamEntry" });
export type SourceStreamEntry = typeof SourceStreamEntry.Type;

/** A page of a source's streams, in group then name order. */
export const SourceStreamPage = Schema.Struct({
  total: Schema.Int,
  streams: Schema.Array(SourceStreamEntry),
}).annotate({ identifier: "SourceStreamPage" });
export type SourceStreamPage = typeof SourceStreamPage.Type;

/** Which streams the picker lists. */
export const SourceStreamFilter = Schema.Literals(["all", "added", "notAdded", "new", "ignored"]);
export type SourceStreamFilter = typeof SourceStreamFilter.Type;

/** One playlist group (`group-title`) of a source. */
export const SourceGroup = Schema.Struct({
  /** The group title; absent for streams without one. */
  name: Schema.optionalKey(Schema.String),
  streams: Schema.Int,
  /** Streams whose tvg-id the source's guide has. */
  withGuide: Schema.Int,
  /** `withGuide` of `streams`, in whole percent. */
  guideCoverage: Schema.Int,
  added: Schema.Int,
  new: Schema.Int,
  ignored: Schema.Int,
}).annotate({ identifier: "SourceGroup" });
export type SourceGroup = typeof SourceGroup.Type;

/** Streams of one source to act on. */
export const SourceStreamSelection = Schema.Struct({
  streamIds: Schema.Array(SourceStreamId).check(Schema.isMinLength(1)),
}).annotate({ identifier: "SourceStreamSelection" });
export type SourceStreamSelection = typeof SourceStreamSelection.Type;

/** Sets streams aside, or (`ignored: false`) brings them back. */
export const SourceStreamIgnore = Schema.Struct({
  streamIds: Schema.Array(SourceStreamId).check(Schema.isMinLength(1)),
  ignored: Schema.Boolean,
}).annotate({ identifier: "SourceStreamIgnore" });
export type SourceStreamIgnore = typeof SourceStreamIgnore.Type;

/**
 * What adding streams did: channels created (copies of one channel become one channel, best
 * quality first) and streams that joined an existing channel with the same guide id as its
 * last fallback.
 */
export const AddedStreams = Schema.Struct({
  created: Schema.Array(Channel),
  joined: Schema.Array(Schema.Struct({ sourceStreamId: SourceStreamId, channel: ChannelRef })),
}).annotate({ identifier: "AddedStreams" });
export type AddedStreams = typeof AddedStreams.Type;

const params = { sourceId: SourceId };

/** Sources: upstream providers (admin). Secrets go in and never come back out. */
export class SourcesGroup extends HttpApiGroup.make("sources")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(SourceView) }),
    HttpApiEndpoint.get("get", "/:sourceId", { params, success: SourceView, error: NotFound }),
    HttpApiEndpoint.post("create", "/", {
      payload: SourceInput,
      success: SourceView,
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.patch("update", "/:sourceId", {
      params,
      payload: SourceUpdate,
      success: SourceView,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.delete("remove", "/:sourceId", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.post("refresh", "/:sourceId/refresh", {
      params,
      success: SourceCheck,
      error: [NotFound, SourceFailed, Forbidden],
    }),
    HttpApiEndpoint.post("test", "/test", {
      payload: SourceInput,
      success: SourceCheck,
      error: [InvalidInput, SourceFailed, Forbidden],
    }),
    HttpApiEndpoint.get("streams", "/:sourceId/streams", {
      params,
      query: { search: Schema.optionalKey(Schema.String) },
      success: Schema.Array(SourceStreamView),
      error: NotFound,
    }),
    HttpApiEndpoint.get("catalogue", "/:sourceId/catalogue", {
      params,
      query: {
        search: Schema.optionalKey(Schema.String),
        group: Schema.optionalKey(Schema.String),
        filter: Schema.optionalKey(SourceStreamFilter),
        offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
        limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      },
      success: SourceStreamPage,
      error: NotFound,
    }),
    HttpApiEndpoint.get("groups", "/:sourceId/groups", {
      params,
      success: Schema.Array(SourceGroup),
      error: NotFound,
    }),
    HttpApiEndpoint.post("addStreams", "/:sourceId/streams/add", {
      params,
      payload: SourceStreamSelection,
      success: AddedStreams,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("ignoreStreams", "/:sourceId/streams/ignore", {
      params,
      payload: SourceStreamIgnore,
      success: HttpApiSchema.NoContent,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("markReviewed", "/:sourceId/reviewed", {
      params,
      success: SourceView,
      error: [NotFound, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/sources")
  .annotateMerge(OpenApi.annotations({ title: "Sources" })) {}
