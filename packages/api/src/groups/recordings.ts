import { Schema, Struct } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  Artwork,
  ChannelId,
  CollectionId,
  DAY,
  GroupPath,
  Instant,
  Padding,
  PlacementExplanation,
  ProgrammeId,
  Recording,
  RecordingId,
  RecordingRef,
  RecordingState,
  RerunView,
  RetentionPolicyFrom,
  RetentionReason,
  RuleId,
  SourceId,
  TimeRange,
} from "@slipstream/domain";
import { Conflict, Forbidden, InvalidInput, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";
import { Label } from "../primitives.ts";

/**
 * The longest stretch of a channel one request may name, in milliseconds: a manual range
 * recording, or a range playback session (start over). Longer ones are refused with
 * `rangeTooLong`.
 */
export const rangeMaxMillis = DAY;

/**
 * On a repeat: the damaged recording it replaces ("Replaces the recording from Sun 22"), and
 * whether the replacement happened and can still be undone.
 */
export const ReplacesRef = RecordingRef.mapFields(
  Struct.assign({
    /**
     * When this repeat replaced its original: set only when the original is hidden as
     * `replaced` and its `replacedById` is this repeat.
     */
    replacedAt: Schema.optionalKey(Instant),
    /**
     * Until when "Keep the original" is allowed: set only while it is (replaced, the original
     * not an anchor, within the hidden retention of 7 days).
     */
    keepUntil: Schema.optionalKey(Instant),
  }),
).annotate({ identifier: "ReplacesRef" });
export type ReplacesRef = typeof ReplacesRef.Type;

/**
 * A recording as the library shows it: with its group path, why it sits there, and the
 * caller's own playback state (`watched`, `positionMillis`; `false` and `0` before they
 * started it), so lists can filter Unwatched / Watched and show resume bars.
 */
export const RecordingEntry = Recording.mapFields(
  Struct.assign({
    group: GroupPath,
    placement: Schema.optionalKey(PlacementExplanation),
    /** Bytes in the segment store or export. */
    sizeBytes: Schema.Int,
    /** Whether the caller finished watching it. */
    watched: Schema.Boolean,
    /** The caller's resume position from the recording's start. */
    positionMillis: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    /** The picture every surface shows for it, from `resolveArtwork` (SPEC 7.4). */
    artwork: Schema.optionalKey(Artwork),
    /**
     * The absolute export path: where it was exported, or for scheduled and running recordings
     * where it will be ("When the recording ends, as /media/tv/…"). Absent when export is off
     * or nothing was captured.
     */
    exportPath: Schema.optionalKey(Schema.String),
    /** On a repeat: the damaged recording it replaces ("Replaces the recording from Sun 22"). */
    replaces: Schema.optionalKey(ReplacesRef),
    /** On a damaged recording of a series recording: where its search for a repeat stands. */
    rerun: Schema.optionalKey(RerunView),
  }),
).annotate({ identifier: "RecordingEntry" });
export type RecordingEntry = typeof RecordingEntry.Type;

/**
 * Record a guide programme, or a manual time range on a channel. Without `padding` the server
 * applies the household default for the programme (`defaultExtraTime`: channel beats category
 * beats global). `collectionId` is the "Goes to" pick: it pins the recording there
 * (`pinnedCollectionId`); a collection-limited profile must name one of its own collections
 * (`Forbidden` otherwise).
 */
export const RecordingRequest = Schema.TaggedUnion({
  Programme: {
    programmeId: ProgrammeId,
    padding: Schema.optionalKey(Padding),
    collectionId: Schema.optionalKey(CollectionId),
  },
  Manual: {
    channelId: ChannelId,
    range: TimeRange,
    title: Schema.NonEmptyString,
    collectionId: Schema.optionalKey(CollectionId),
  },
}).annotate({ identifier: "RecordingRequest" });
export type RecordingRequest = typeof RecordingRequest.Type;

/** Changes someone can make to a recording. `pinnedCollectionId: null` unpins it. */
export const RecordingUpdate = Schema.Struct({
  protected: Schema.optionalKey(Schema.Boolean),
  labels: Schema.optionalKey(Schema.Array(Label)),
  pinnedCollectionId: Schema.optionalKey(Schema.NullOr(CollectionId)),
  /** Extend or shorten a scheduled or running recording ("red flag"). */
  padding: Schema.optionalKey(Padding),
}).annotate({ identifier: "RecordingUpdate" });
export type RecordingUpdate = typeof RecordingUpdate.Type;

/**
 * A stretch of time in which scheduled recordings exceed a source's stream limit. `capacity` is
 * how many recordings the sources can carry at once then ("only 2 can record at once"): their
 * free streams for the window, the source limits minus the streams kept and in use for anything
 * recordings cannot take.
 */
export const ScheduleConflict = Schema.Struct({
  range: TimeRange,
  channelIds: Schema.Array(ChannelId),
  recordingIds: Schema.Array(RecordingId),
  sourceIds: Schema.Array(SourceId),
  capacity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "ScheduleConflict" });
export type ScheduleConflict = typeof ScheduleConflict.Type;

/** A recording retention will delete on its next run, and why. */
export const RetentionCandidate = Schema.Struct({
  recordingId: RecordingId,
  reason: RetentionReason,
  /** Whose policy applies: the collection's when it sets one, otherwise the rule's. */
  policyFrom: RetentionPolicyFrom,
}).annotate({ identifier: "RetentionCandidate" });
export type RetentionCandidate = typeof RetentionCandidate.Type;

const params = { recordingId: RecordingId };

/**
 * Recordings: one-off recordings, the library, scheduling conflicts and retention. Hidden
 * recordings (replaced by a repeat, or deleted while their chain still looks for one) are left
 * out of `list`; `get` still answers them, for "Keep the original".
 */
export class RecordingsGroup extends HttpApiGroup.make("recordings")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: {
        state: Schema.optionalKey(RecordingState),
        channelId: Schema.optionalKey(ChannelId),
        ruleId: Schema.optionalKey(RuleId),
        collectionId: Schema.optionalKey(CollectionId),
        /** Only recordings the caller owns. */
        mine: Schema.optionalKey(Schema.Boolean),
        /** Only recordings the caller has (`true`) or has not (`false`) watched. */
        watched: Schema.optionalKey(Schema.Boolean),
      },
      success: Schema.Array(RecordingEntry),
    }),
    HttpApiEndpoint.get("get", "/:recordingId", {
      params,
      success: RecordingEntry,
      error: NotFound,
    }),
    HttpApiEndpoint.post("create", "/", {
      payload: RecordingRequest,
      success: RecordingEntry,
      error: [NotFound, InvalidInput, Conflict, Forbidden],
    }),
    HttpApiEndpoint.patch("update", "/:recordingId", {
      params,
      payload: RecordingUpdate,
      success: RecordingEntry,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("stop", "/:recordingId/stop", {
      params,
      success: RecordingEntry,
      error: [NotFound, Conflict, Forbidden],
    }),
    HttpApiEndpoint.delete("remove", "/:recordingId", {
      params,
      query: {
        /**
         * `skip`: "Delete, record it again when repeated", no episode history row for a good
         * recording of a series recording that leaves out repeats.
         */
        history: Schema.optionalKey(Schema.Literal("skip")),
        /** `stop`: "Delete and stop looking for a repeat" for a damaged recording. */
        rerun: Schema.optionalKey(Schema.Literal("stop")),
      },
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
    /**
     * "Keep the original" on a repeat that replaced a damaged recording (within 7 days): the
     * original is shown again beside the repeat, its search ends as `kept`. Answers the original.
     */
    HttpApiEndpoint.post("keepOriginal", "/:recordingId/keep-original", {
      params: {
        recordingId: RecordingId.annotate({
          description:
            "The REPEAT's id: the recording that replaced the original, not the original.",
        }),
      },
      success: RecordingEntry,
      error: [NotFound, Conflict, Forbidden],
    }),
    HttpApiEndpoint.get("conflicts", "/conflicts", {
      query: { from: Instant, to: Instant },
      success: Schema.Array(ScheduleConflict),
    }),
    HttpApiEndpoint.get("retention", "/retention", {
      success: Schema.Array(RetentionCandidate),
    }),
  )
  .middleware(Authentication)
  .prefix("/recordings")
  .annotateMerge(OpenApi.annotations({ title: "Recordings" })) {}
