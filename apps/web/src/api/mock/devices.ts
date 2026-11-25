import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { SlipstreamApi } from "@slipstream/api";
import { type MockContext, notFound, notInMock } from "./context.ts";

/**
 * The mock's `devices` group: signed-in devices and revoking them.
 * The shared state is in context.ts.
 */
export const devicesGroup = (ctx: MockContext) => {
  const { data } = ctx;
  return HttpApiBuilder.group(SlipstreamApi, "devices", (handlers) =>
    handlers
      .handle("list", () =>
        Effect.sync(() => data.devices.filter((d) => d.revokedAt === undefined)),
      )
      .handle("rename", () => notInMock)
      .handle("revoke", ({ params }) =>
        Effect.gen(function* () {
          if (!data.devices.some((d) => d.id === params.deviceId)) {
            return yield* notFound("device", params.deviceId);
          }
          data.devices = data.devices.filter((d) => d.id !== params.deviceId);
        }),
      ),
  );
};
