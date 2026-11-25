import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { SlipstreamApi } from "@slipstream/api";
import { type MockContext, notInMock } from "./context.ts";

/**
 * The mock's `captures` group: the running captures the shell and Home show.
 */
export const capturesGroup = (ctx: MockContext) => {
  const { data } = ctx;
  return HttpApiBuilder.group(SlipstreamApi, "captures", (handlers) =>
    handlers
      .handle("list", ({ query }) =>
        Effect.sync(() =>
          query.active ? data.captures.filter((c) => c.endedAt === undefined) : data.captures,
        ),
      )
      .handle("get", () => notInMock)
      .handle("log", () => notInMock)
      .handle("stop", () => notInMock),
  );
};
