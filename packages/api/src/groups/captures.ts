import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";
import { Capture, CaptureId, Instant } from "@slipstream/domain";
import { Forbidden, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";

/** One line of a capture's ffmpeg log. */
export const LogLine = Schema.Struct({
  at: Instant,
  level: Schema.Literals(["debug", "info", "warning", "error"]),
  message: Schema.String,
}).annotate({ identifier: "LogLine" });
export type LogLine = typeof LogLine.Type;

const params = { captureId: CaptureId };

/** Captures: live status of upstream connections, logs and stats (admin). */
export class CapturesGroup extends HttpApiGroup.make("captures")
  .add(
    HttpApiEndpoint.get("list", "/", {
      query: { active: Schema.optionalKey(Schema.Boolean) },
      success: Schema.Array(Capture),
    }),
    HttpApiEndpoint.get("get", "/:captureId", { params, success: Capture, error: NotFound }),
    HttpApiEndpoint.get("log", "/:captureId/log", {
      params,
      query: { after: Schema.optionalKey(Instant) },
      success: Schema.Array(LogLine),
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.post("stop", "/:captureId/stop", {
      params,
      success: Capture,
      error: [NotFound, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/captures")
  .annotateMerge(OpenApi.annotations({ title: "Captures" })) {}
