import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  Channel,
  ChannelId,
  ChannelInput,
  ChannelStream,
  ChannelUpdate,
  MatchReason,
  SourceId,
  SourceStreamId,
} from "@slipstream/domain";
import { Forbidden, InvalidInput, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/** What an admin sends to create or change a channel. Defined in the domain. */
export { ChannelInput, ChannelUpdate } from "@slipstream/domain";

/** One entry of a channel's stream list, in fallback order. */
export const ChannelStreamInput = Schema.Struct({
  sourceStreamId: SourceStreamId,
  priority: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "ChannelStreamInput" });
export type ChannelStreamInput = typeof ChannelStreamInput.Type;

/** Sets one channel's number (admin). A channel holding it moves to the next free number above. */
export const ChannelNumber = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "ChannelNumber" });
export type ChannelNumber = typeof ChannelNumber.Type;

/**
 * Moves channels to consecutive numbers from `start`, in the given order (admin). Channels
 * holding those numbers move to the next free number above; no other channel changes.
 */
export const ChannelNumbering = Schema.Struct({
  ids: Schema.Array(ChannelId).check(Schema.isMinLength(1)),
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "ChannelNumbering" });
export type ChannelNumbering = typeof ChannelNumbering.Type;

/**
 * Channels to act on at once (admin): to remove (recordings, history and rules stay; one-off
 * recordings still scheduled on them are cancelled), or to keep apart ("Not the same": never
 * suggested for merging with one another again; needs two or more).
 */
export const ChannelSelection = Schema.Struct({
  ids: Schema.Array(ChannelId).check(Schema.isMinLength(1)),
}).annotate({ identifier: "ChannelSelection" });
export type ChannelSelection = typeof ChannelSelection.Type;

/**
 * What removing channels changes beyond the lineup: one-off recordings still scheduled on them
 * are cancelled, as they would find no stream. Series recordings just stop matching them.
 */
export const ChannelRemovePreview = Schema.Struct({ scheduledRecordings: Schema.Int }).annotate({
  identifier: "ChannelRemovePreview",
});
export type ChannelRemovePreview = typeof ChannelRemovePreview.Type;

/** Merges `otherIds` into `keepId` (admin). */
export const ChannelMerge = Schema.Struct({
  keepId: ChannelId,
  otherIds: Schema.Array(ChannelId).check(Schema.isMinLength(1)),
}).annotate({ identifier: "ChannelMerge" });
export type ChannelMerge = typeof ChannelMerge.Type;

/**
 * What a merge moves to the kept channel, so the UI can say "2 series recordings and 14
 * recordings move to ZDF". Recordings count those people see (not replaced or deleted ones).
 */
export const ChannelMergePreview = Schema.Struct({
  keep: Channel,
  others: Schema.Array(Channel),
  streams: Schema.Int,
  recordings: Schema.Int,
  seriesRecordings: Schema.Int,
  collections: Schema.Int,
}).annotate({ identifier: "ChannelMergePreview" });
export type ChannelMergePreview = typeof ChannelMergePreview.Type;

/** Takes one stream out of a channel into a new channel of its own (admin). */
export const ChannelSplit = Schema.Struct({ sourceStreamId: SourceStreamId }).annotate({
  identifier: "ChannelSplit",
});
export type ChannelSplit = typeof ChannelSplit.Type;

/** A channel by id and name, as review lists name them. */
export const ChannelRef = Schema.Struct({ id: ChannelId, name: Schema.String }).annotate({
  identifier: "ChannelRef",
});
export type ChannelRef = typeof ChannelRef.Type;

/** A stream of a merge candidate, named with its source. */
export const MergeCandidateStream = Schema.Struct({
  name: Schema.String,
  sourceName: Schema.String,
}).annotate({ identifier: "MergeCandidateStream" });
export type MergeCandidateStream = typeof MergeCandidateStream.Type;

/** A channel of a merge suggestion, with its number, logo and streams in fallback order. */
export const MergeCandidate = Schema.Struct({
  id: ChannelId,
  name: Schema.String,
  number: Schema.optionalKey(Schema.Int),
  logoUrl: Schema.optionalKey(Schema.String),
  streams: Schema.Array(MergeCandidateStream),
}).annotate({ identifier: "MergeCandidate" });
export type MergeCandidate = typeof MergeCandidate.Type;

/**
 * Channels that look like one channel; the first is the one to keep (the one the lineup had
 * first, so its number, rules and recordings stay).
 */
export const MergeSuggestionView = Schema.Struct({
  channels: Schema.Array(MergeCandidate),
  reason: MatchReason,
}).annotate({ identifier: "MergeSuggestionView" });
export type MergeSuggestionView = typeof MergeSuggestionView.Type;

/** A source's streams waiting for a decision. */
export const SourceReview = Schema.Struct({
  sourceId: SourceId,
  name: Schema.String,
  /** Streams first seen since the last review, neither added nor ignored. */
  newStreams: Schema.Int,
  /** Streams of channels the playlist no longer lists. */
  goneStreams: Schema.Int,
}).annotate({ identifier: "SourceReview" });
export type SourceReview = typeof SourceReview.Type;

/** A stream a channel uses that its playlist no longer lists. */
export const GoneStream = Schema.Struct({
  sourceStreamId: SourceStreamId,
  sourceId: SourceId,
  name: Schema.String,
  channel: ChannelRef,
  /** The source of the channel's first stream still listed, when it has one. */
  playsFrom: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "GoneStream" });
export type GoneStream = typeof GoneStream.Type;

/** What needs an admin's eye in the lineup (admin). */
export const ChannelReview = Schema.Struct({
  mergeSuggestions: Schema.Array(MergeSuggestionView),
  sources: Schema.Array(SourceReview),
  /** Streams gone from visible channels (a hidden channel's wait until it is shown). */
  goneStreams: Schema.Array(GoneStream),
  /** Visible channels with no stream left (none linked, or every one gone). */
  withoutStreams: Schema.Array(ChannelRef),
}).annotate({ identifier: "ChannelReview" });
export type ChannelReview = typeof ChannelReview.Type;

/** A guide channel of a source, for mapping a channel to its guide. */
export const GuideChannelView = Schema.Struct({
  sourceId: SourceId,
  xmltvId: Schema.String,
  displayName: Schema.String,
  iconUrl: Schema.optionalKey(Schema.String),
  /** Live channels already mapped to it. */
  channels: Schema.Int,
  /** For a suggestion: why it fits the channel. */
  reason: Schema.optionalKey(MatchReason),
  /** The title of what the guide has on now. */
  now: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "GuideChannelView" });
export type GuideChannelView = typeof GuideChannelView.Type;

const params = { channelId: ChannelId };

/** Channels: the curated channel list. Reading is for everyone, editing for admins. */
export class ChannelsGroup extends HttpApiGroup.make("channels")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: { includeHidden: Schema.optionalKey(Schema.Boolean) },
      success: Schema.Array(Channel),
    }),
    HttpApiEndpoint.get("get", "/:channelId", { params, success: Channel, error: NotFound }),
    HttpApiEndpoint.post("create", "/", {
      payload: ChannelInput,
      success: Channel,
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("placeNumbers", "/numbers", {
      payload: ChannelNumbering,
      success: Schema.Array(Channel),
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("removeMany", "/remove", {
      payload: ChannelSelection,
      success: HttpApiSchema.NoContent,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("removePreview", "/remove/preview", {
      payload: ChannelSelection,
      success: ChannelRemovePreview,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("mergePreview", "/merge/preview", {
      payload: ChannelMerge,
      success: ChannelMergePreview,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("merge", "/merge", {
      payload: ChannelMerge,
      success: Channel,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.get("review", "/review", { success: ChannelReview, error: Forbidden }),
    HttpApiEndpoint.post("keepApart", "/apart", {
      payload: ChannelSelection,
      success: HttpApiSchema.NoContent,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.get("guideChannels", "/guide-channels", {
      query: { search: Schema.optionalKey(Schema.String) },
      success: Schema.Array(GuideChannelView),
      error: Forbidden,
    }),
    HttpApiEndpoint.patch("update", "/:channelId", {
      params,
      payload: ChannelUpdate,
      success: Channel,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.delete("remove", "/:channelId", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.put("setNumber", "/:channelId/number", {
      params,
      payload: ChannelNumber,
      success: Schema.Array(Channel),
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.post("split", "/:channelId/split", {
      params,
      payload: ChannelSplit,
      success: Channel,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.get("guideSuggestions", "/:channelId/guide-suggestions", {
      params,
      success: Schema.Array(GuideChannelView),
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.get("streams", "/:channelId/streams", {
      params,
      success: Schema.Array(ChannelStream),
      error: NotFound,
    }),
    HttpApiEndpoint.put("setStreams", "/:channelId/streams", {
      params,
      payload: Schema.Array(ChannelStreamInput),
      success: Schema.Array(ChannelStream),
      error: [NotFound, InvalidInput, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/channels")
  .annotateMerge(OpenApi.annotations({ title: "Channels" })) {}
