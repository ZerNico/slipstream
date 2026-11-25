import { NotFound, Unauthorized } from "@slipstream/api";
import type { RecordingId } from "@slipstream/domain";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { describe, expect, it } from "vitest";
import { runAction } from "./actions.ts";
import { makeApiRuntime } from "./client.ts";
import { apiActions } from "./queries.ts";

/** A runtime whose fetch answers `status` and `body` to every request. */
const answering = (status: number, body: unknown) => {
  const runtime = makeApiRuntime({ baseUrl: "http://tv.local", token: "token" });
  const fetch = () =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  const provide = Effect.provideService(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch);
  return { runtime, provide };
};

const skip = apiActions.deleteRecording("r1" as RecordingId);

describe("runAction", () => {
  it("tells about a refused token on a write, then fails with it", async () => {
    const { runtime, provide } = answering(401, { _tag: "Unauthorized" });
    let refused = 0;
    const error = await runAction(runtime, skip.pipe(provide), () => {
      refused += 1;
    }).catch((cause: unknown) => cause);
    await runtime.dispose();
    expect(error).toBeInstanceOf(Unauthorized);
    expect(refused).toBe(1);
  });

  it("passes other failures through without signing anyone out", async () => {
    const { runtime, provide } = answering(404, {
      _tag: "NotFound",
      entity: "recording",
      id: "r1",
    });
    let refused = 0;
    const error = await runAction(runtime, skip.pipe(provide), () => {
      refused += 1;
    }).catch((cause: unknown) => cause);
    await runtime.dispose();
    expect(error).toBeInstanceOf(NotFound);
    expect(refused).toBe(0);
  });

  it("resolves with the answer when the write succeeds", async () => {
    const { runtime, provide } = answering(204, undefined);
    let refused = 0;
    await expect(
      runAction(runtime, skip.pipe(provide), () => {
        refused += 1;
      }),
    ).resolves.toBeUndefined();
    await runtime.dispose();
    expect(refused).toBe(0);
  });
});
