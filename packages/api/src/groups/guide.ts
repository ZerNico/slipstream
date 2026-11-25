import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import {
  ChannelId,
  GuideEntry,
  GuideRepeat,
  Instant,
  Programme,
  ProgrammeId,
} from "@slipstream/domain";
import { InvalidInput, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/** What is on a channel now and next. */
export const NowNext = Schema.Struct({
  channelId: ChannelId,
  now: Schema.optionalKey(Programme),
  next: Schema.optionalKey(Programme),
}).annotate({ identifier: "NowNext" });
export type NowNext = typeof NowNext.Type;

/**
 * Where the caller's guide data ends (the last programme on a channel they see), absent while
 * there is none: the timeline is as wide as its data before the days load one by one.
 */
export const GuideExtent = Schema.Struct({ end: Schema.optionalKey(Instant) }).annotate({
  identifier: "GuideExtent",
});
export type GuideExtent = typeof GuideExtent.Type;

/**
 * Guide: programmes by time window (as `GuideEntry`, the details load per programme), how far
 * the data reaches, now/next and search.
 */
export class GuideGroup extends HttpApiGroup.make("guide")
  .add(
    HttpApiEndpoint.get("window", "/", {
      query: {
        from: Instant,
        to: Instant,
        /** Comma-separated channel ids; all visible channels when absent. */
        channels: Schema.optionalKey(Schema.String),
      },
      success: Schema.Array(GuideEntry),
      error: InvalidInput,
    }),
    HttpApiEndpoint.get("extent", "/extent", { success: GuideExtent }),
    HttpApiEndpoint.get("nowNext", "/now-next", { success: Schema.Array(NowNext) }),
    HttpApiEndpoint.get("search", "/search", {
      query: { q: Schema.NonEmptyString, from: Schema.optionalKey(Instant) },
      success: Schema.Array(Programme),
    }),
    /**
     * Airings in the window the caller already has (§3.6): `ruleId` when one of their series
     * recordings left it out, absent when they merely see a copy of the episode. Computed with
     * the planner's own function and filtered by what the caller may see; feeds the guide's
     * `repeat` mark.
     */
    HttpApiEndpoint.get("repeats", "/repeats", {
      query: { from: Instant, to: Instant },
      success: Schema.Array(GuideRepeat),
      error: InvalidInput,
    }),
    HttpApiEndpoint.get("programme", "/programmes/:programmeId", {
      params: { programmeId: ProgrammeId },
      success: Programme,
      error: NotFound,
    }),
  )
  .middleware(Authentication)
  .prefix("/guide")
  .annotateMerge(OpenApi.annotations({ title: "Guide" })) {}
