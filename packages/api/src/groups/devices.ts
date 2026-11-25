import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";
import { Device, DeviceId } from "@slipstream/domain";
import { Forbidden, NotFound } from "../errors.ts";
import { Authentication } from "../security.ts";
import { Name } from "../primitives.ts";

const params = { deviceId: DeviceId };

/** Devices: the caller's paired devices (admins see everyone's). */
export class DevicesGroup extends HttpApiGroup.make("devices")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(Device) }),
    HttpApiEndpoint.patch("rename", "/:deviceId", {
      params,
      payload: Schema.Struct({ name: Name }),
      success: Device,
      error: [NotFound, Forbidden],
    }),
    HttpApiEndpoint.delete("revoke", "/:deviceId", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFound, Forbidden],
    }),
  )
  .middleware(Authentication)
  .prefix("/devices")
  .annotateMerge(OpenApi.annotations({ title: "Devices" })) {}
