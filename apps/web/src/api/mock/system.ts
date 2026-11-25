import { Effect, Queue, Stream } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { type ServerEvent, SlipstreamApi } from "@slipstream/api";
import { type MockContext, now } from "./context.ts";

/**
 * The mock's `system` group: health, server info and the live event stream.
 * The shared state is in context.ts.
 */
export const systemGroup = (ctx: MockContext) => {
  const { data, listeners } = ctx;
  return HttpApiBuilder.group(SlipstreamApi, "system", (handlers) =>
    handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("info", () => Effect.sync(() => data.system))
      .handle("events", () =>
        Effect.succeed(
          Stream.callback<ServerEvent>((queue) => {
            const listener = (event: ServerEvent) => {
              Queue.offerUnsafe(queue, event);
            };
            return Effect.acquireRelease(
              Effect.sync(() => {
                // First thing on every connection, so clients know the stream is live.
                Queue.offerUnsafe(queue, { _tag: "Connected", at: now() });
                listeners.add(listener);
              }),
              () => Effect.sync(() => listeners.delete(listener)),
            );
          }),
        ),
      ),
  );
};
