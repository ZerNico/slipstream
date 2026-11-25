import { DateTime, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { Artwork, type Instant, ProgrammeId, RecordingId } from "@slipstream/domain";
import { NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/** What a picture is for. */
export const ArtworkTarget = Schema.TaggedUnion({
  Programme: { programmeId: ProgrammeId },
  Recording: { recordingId: RecordingId },
}).annotate({ identifier: "ArtworkTarget" });
export type ArtworkTarget = typeof ArtworkTarget.Type;

/** The resolved picture of one programme or recording. */
export const ArtworkEntry = Schema.Struct({
  target: ArtworkTarget,
  artwork: Artwork,
}).annotate({ identifier: "ArtworkEntry" });
export type ArtworkEntry = typeof ArtworkEntry.Type;

/** Media type of grabbed frames. */
export const frameContentType = "image/jpeg";

/**
 * Where a recording's frame is served. `v` is the frame's moment in epoch milliseconds, so the
 * URL changes when a frame is grabbed again and the response can be cached as immutable.
 */
export const frameUrl = (recordingId: RecordingId, grabbedAt: Instant): string =>
  `/api/artwork/frames/${encodeURIComponent(recordingId)}?v=${DateTime.toEpochMillis(grabbedAt)}`;

/**
 * Artwork (SPEC 7.4), from the one resolver (`resolveArtwork` in the domain) with the
 * household's artwork order: the guide's image, a frame grabbed 10 minutes into the programme
 * (running recordings included; a programme with a running recording uses that recording's
 * frame), else generated artwork. Library entries carry theirs already (`RecordingEntry.artwork`).
 *
 * - `resolve`: comma-separated ids, at most 200 in all; ids the caller cannot see or that do not
 *   exist are left out of the answer rather than failing the batch.
 * - `frame`: the JPEG bytes (`Cache-Control: private, max-age=31536000, immutable`), from the
 *   session cookie or bearer token like every other endpoint. `NotFound` with entity `frame`
 *   until one was grabbed, entity `recording` when the caller cannot see the recording.
 */
export class ArtworkGroup extends HttpApiGroup.make("artwork")
  .add(
    HttpApiEndpoint.get("resolve", "/", {
      query: {
        programmeIds: Schema.optionalKey(Schema.String),
        recordingIds: Schema.optionalKey(Schema.String),
      },
      success: Schema.Array(ArtworkEntry),
    }),
    HttpApiEndpoint.get("frame", "/frames/:recordingId", {
      params: { recordingId: RecordingId },
      query: { v: Schema.optionalKey(Schema.String) },
      success: Schema.Uint8Array.pipe(
        HttpApiSchema.asUint8Array({ contentType: frameContentType }),
      ),
      error: NotFound,
    }),
  )
  .middleware(Authentication)
  .prefix("/artwork")
  .annotateMerge(OpenApi.annotations({ title: "Artwork" })) {}
