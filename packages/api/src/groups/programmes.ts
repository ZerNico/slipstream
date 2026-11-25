import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { ProgrammeId, RecordOptions } from "@slipstream/domain";
import { NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/**
 * Programmes: per-profile answers about one guide entry. `NotFound` also when the programme is
 * on a channel the caller cannot see.
 */
export class ProgrammesGroup extends HttpApiGroup.make("programmes")
  .add(
    HttpApiEndpoint.get("recordOptions", "/:programmeId/record-options", {
      params: { programmeId: ProgrammeId },
      success: RecordOptions,
      error: NotFound,
    }),
  )
  .middleware(Authentication)
  .prefix("/programmes")
  .annotateMerge(OpenApi.annotations({ title: "Programmes" })) {}
