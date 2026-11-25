import { Schema, Struct } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  ChannelId,
  Collection,
  CollectionId,
  GroupPath,
  Instant,
  MatcherExtension,
  PlacementReason,
  ProgrammeId,
  RecordingId,
} from "@slipstream/domain";
import { Conflict, Forbidden, InvalidInput, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";
import { Label } from "../primitives.ts";

/**
 * What an admin sends to create a collection: always with its own conditions. A collection that
 * follows a series recording is made by `POST /rules/:id/collection`, never here.
 */
export const CollectionInput = Collection.mapFields((fields) => ({
  ...Struct.omit(fields, ["id", "follows"]),
  labels: Schema.Array(Label),
})).annotate({
  identifier: "CollectionInput",
});
export type CollectionInput = typeof CollectionInput.Type;

/** A partial update; absent fields stay as they are. A matcher on a linked one: `Conflict`. */
export const CollectionUpdate = CollectionInput.mapFields(Struct.map(Schema.optionalKey)).annotate({
  identifier: "CollectionUpdate",
});
export type CollectionUpdate = typeof CollectionUpdate.Type;

/**
 * How a draft collection would lay out existing recordings, and where it overlaps others.
 * `previewCollection` in the domain computes `recordings` (with `from`) and `elsewhere` with the
 * real precedence; items the layout cannot split sit under an `Other` folder in `group`.
 */
export const CollectionPreview = Schema.Struct({
  recordings: Schema.Array(
    Schema.Struct({
      recordingId: RecordingId,
      title: Schema.String,
      group: GroupPath,
      /** Where it appears today: another collection or an automatic group. */
      from: Schema.optionalKey(GroupPath),
    }),
  ),
  overlaps: Schema.Array(
    Schema.Struct({ collectionId: CollectionId, recordingIds: Schema.Array(RecordingId) }),
  ),
  /** Recordings the draft matches but that stay in another collection, and why. */
  elsewhere: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        recordingId: RecordingId,
        title: Schema.String,
        collectionId: CollectionId,
        reason: PlacementReason,
      }),
    ),
  ),
}).annotate({ identifier: "CollectionPreview" });
export type CollectionPreview = typeof CollectionPreview.Type;

/** A recording or upcoming programme that "also move similar ones" would move. */
export const SimilarItem = Schema.Struct({
  recordingId: Schema.optionalKey(RecordingId),
  /** Set for upcoming guide programmes no recording exists for yet. */
  programmeId: Schema.optionalKey(ProgrammeId),
  channelId: ChannelId,
  title: Schema.String,
  start: Instant,
  /** The collection it leaves; absent when it is in none today. */
  fromCollectionId: Schema.optionalKey(CollectionId),
}).annotate({ identifier: "SimilarItem" });
export type SimilarItem = typeof SimilarItem.Type;

/**
 * What "also move similar ones in the future?" would do after moving a recording by hand: how
 * the collection's matcher widens (`extendMatcher`) and which past and future recordings follow.
 */
export const SimilarPreview = Schema.Struct({
  extension: MatcherExtension,
  past: Schema.Array(SimilarItem),
  future: Schema.Array(SimilarItem),
}).annotate({ identifier: "SimilarPreview" });
export type SimilarPreview = typeof SimilarPreview.Type;

const similarPayload = Schema.Struct({ recordingId: RecordingId });

const params = { collectionId: CollectionId };

/**
 * Collections: household-wide groups with a matcher and a layout (admin edits). Part
 * suggestions from a selection run on the client with `partFromSelection` from the domain;
 * collection suggestions and "also move similar ones" run on the server. `moveSimilar` answers
 * `InvalidInput` with code `cannotExtend` when the matcher cannot be widened (a regex failed).
 * Previews and suggestions answer `Forbidden` to profiles that may not edit collections.
 * `unlink` turns a collection that follows a series recording into one with its own conditions
 * (a copy of the effective matcher). Every `matcher` in an answer is the effective one.
 */
export class CollectionsGroup extends HttpApiGroup.make("collections")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(Collection) }),
    HttpApiEndpoint.get("get", "/:collectionId", {
      params,
      success: Collection,
      error: NotFound,
    }),
    HttpApiEndpoint.post("create", "/", {
      payload: CollectionInput,
      success: Collection,
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.patch("update", "/:collectionId", {
      params,
      payload: CollectionUpdate,
      success: Collection,
      error: [NotFound, InvalidInput, Forbidden, Conflict],
    }),
    HttpApiEndpoint.post("unlink", "/:collectionId/unlink", {
      params,
      success: Collection,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.delete("remove", "/:collectionId", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.put("reorder", "/order", {
      payload: Schema.Struct({ collectionIds: Schema.Array(CollectionId) }),
      success: Schema.Array(Collection),
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("previewSimilar", "/:collectionId/similar/preview", {
      params,
      payload: similarPayload,
      success: SimilarPreview,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.post("moveSimilar", "/:collectionId/similar", {
      params,
      payload: similarPayload,
      success: Collection,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.post("preview", "/preview", {
      payload: Schema.Struct({
        collection: CollectionInput,
        /** The collection being edited, so it is not reported as overlapping itself. */
        collectionId: Schema.optionalKey(CollectionId),
      }),
      success: CollectionPreview,
      error: [InvalidInput, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/collections")
  .annotateMerge(OpenApi.annotations({ title: "Collections" })) {}
