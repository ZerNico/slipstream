import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import {
  Collection,
  CollectionLayout,
  CollectionOffer,
  GroupPath,
  Instant,
  MINUTE,
  Programme,
  Rule,
  RuleId,
  RuleInput,
  RuleMatchSkip,
  RuleUpdate,
  TimeRange,
} from "@slipstream/domain";
import { Conflict, Forbidden, InvalidInput, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/** What someone sends to create or change a rule. Defined in the domain. */
export { RuleInput, RuleUpdate } from "@slipstream/domain";

/** An upcoming programme a draft rule would record, with the padded range. */
export const RuleMatchPreview = Schema.Struct({
  programme: Programme,
  range: TimeRange,
  /** Set when the rule would leave it out, and why (the planner's own reason). */
  skip: Schema.optionalKey(RuleMatchSkip),
  /**
   * Where it would land: the rule's collection, else what "Automatic" picks today, so the editor
   * can say "Automatic (Formel 1)".
   */
  group: Schema.optionalKey(GroupPath),
}).annotate({ identifier: "RuleMatchPreview" });
export type RuleMatchPreview = typeof RuleMatchPreview.Type;

/** What a draft rule would do: the programmes it records. */
export const RulePreview = Schema.Struct({
  matches: Schema.Array(RuleMatchPreview),
  /**
   * "Group these as “Live F1”?" when the matches scatter in the library and the draft has no
   * collection (`collectionOffer`); only for callers who may create collections.
   */
  offer: Schema.optionalKey(CollectionOffer),
}).annotate({ identifier: "RulePreview" });
export type RulePreview = typeof RulePreview.Type;

/** A draft rule to preview, up to `until` (the server picks a default horizon). */
export const RulePreviewRequest = Schema.Struct({
  rule: RuleInput,
  until: Schema.optionalKey(Instant),
}).annotate({ identifier: "RulePreviewRequest" });
export type RulePreviewRequest = typeof RulePreviewRequest.Type;

/** The collection offer for one series recording, when it applies (§3.3). */
export const RuleOffer = Schema.Struct({
  offer: Schema.optionalKey(CollectionOffer),
}).annotate({ identifier: "RuleOffer" });
export type RuleOffer = typeof RuleOffer.Type;

/** "Group them": a collection that follows the series recording, named by the person. */
export const RuleCollectionRequest = Schema.Struct({
  name: Schema.NonEmptyString,
  /** The offer's layout when absent. */
  layout: Schema.optionalKey(CollectionLayout),
}).annotate({ identifier: "RuleCollectionRequest" });
export type RuleCollectionRequest = typeof RuleCollectionRequest.Type;

/** How many deleted episodes the caller's history keeps out for a series recording. */
export const RuleHistory = Schema.Struct({
  count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "RuleHistory" });
export type RuleHistory = typeof RuleHistory.Type;

/**
 * What happens to a collection that follows a deleted series recording: `keep` (the default) keeps
 * it with today's conditions as its own, `remove` deletes it (its recordings go back to
 * automatic groups). Callers who may not edit collections always keep.
 */
export const RuleRemoveCollection = Schema.Literals(["keep", "remove"]);
export type RuleRemoveCollection = typeof RuleRemoveCollection.Type;

/** How long after creating a series recording `DELETE /rules/:id?undo=true` takes it back. */
export const ruleUndoWindowMillis = 10 * MINUTE;

const params = { ruleId: RuleId };

/**
 * Rules, shown as series recordings: standing orders to record whatever matches.
 *
 * - `remove`: `collection=keep|remove` decides about a collection that follows it; `undo=true`
 *   (within `ruleUndoWindowMillis` of creation, else `Conflict` `undoExpired`) also takes back
 *   the scheduled items, the owners it added to existing recordings and a collection that follows
 *   it and was created after it.
 * - `offer` / `declineOffer`: the collection offer and its permanent "No thanks".
 * - `group` / `ungroup`: "Group them" (a linked collection plus the rule's `collectionId`, one
 *   transaction; `Forbidden` without the right to create collections) and its Undo.
 * - `history` / `forgetHistory`: the caller's deleted episodes this series recording keeps out.
 */
export class RulesGroup extends HttpApiGroup.make("rules")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(Rule) }),
    HttpApiEndpoint.get("get", "/:ruleId", { params, success: Rule, error: NotFound }),
    HttpApiEndpoint.post("create", "/", {
      payload: RuleInput,
      success: Rule,
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.patch("update", "/:ruleId", {
      params,
      payload: RuleUpdate,
      success: Rule,
      error: [NotFound, InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.delete("remove", "/:ruleId", {
      params,
      query: {
        collection: Schema.optionalKey(RuleRemoveCollection),
        undo: Schema.optionalKey(Schema.Boolean),
      },
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden, Conflict],
    }),
    HttpApiEndpoint.post("preview", "/preview", {
      payload: RulePreviewRequest,
      success: RulePreview,
      error: [InvalidInput, Forbidden],
    }),
    HttpApiEndpoint.get("offer", "/:ruleId/offer", {
      params,
      success: RuleOffer,
      error: NotFound,
    }),
    HttpApiEndpoint.post("declineOffer", "/:ruleId/offer/decline", {
      params,
      success: Rule,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.post("group", "/:ruleId/collection", {
      params,
      payload: RuleCollectionRequest,
      success: Collection,
      error: [NotFound, InvalidInput, Forbidden, Conflict],
    }),
    HttpApiEndpoint.delete("ungroup", "/:ruleId/collection", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.get("history", "/:ruleId/history", {
      params,
      success: RuleHistory,
      error: NotFound,
    }),
    HttpApiEndpoint.delete("forgetHistory", "/:ruleId/history", {
      params,
      success: RuleHistory,
      error: [NotFound, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/rules")
  .annotateMerge(OpenApi.annotations({ title: "Rules" })) {}
