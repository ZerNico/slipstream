import { RecordingEntry } from "@slipstream/api";
import { RecordingId } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { describe, expect, it } from "vitest";
import { recording } from "../../tests/fixtures.ts";
import type { Toast } from "../ui/toast.ts";
import { makeApiRuntime } from "./client.ts";
import { announceReplaced } from "./replaced.ts";

const T = Date.UTC(2026, 10, 25, 21);

/** A runtime whose fetch answers `status` and `body`, remembering the paths it was asked. */
const answering = (status: number, body: unknown) => {
  const paths: string[] = [];
  const runtime = makeApiRuntime({ baseUrl: "http://tv.local", token: "token" });
  const fetch = (input: RequestInfo | URL) => {
    paths.push(new URL(input instanceof Request ? input.url : input.toString()).pathname);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const provide = Effect.provideService(FetchHttpClient.Fetch, fetch);
  return { runtime, provide, paths };
};

describe("announceReplaced", () => {
  it("names the show and the day of the repeat that replaced it", async () => {
    const repeat = recording({
      id: "tatort-one",
      channelId: "one",
      start: T,
      end: T + 90 * 60_000,
      title: "Tatort",
      state: "completed",
    });
    const { runtime, provide, paths } = answering(200, Schema.encodeSync(RecordingEntry)(repeat));
    const shown: Toast[] = [];
    await runtime.runPromise(
      announceReplaced(RecordingId.make("tatort-one"), (toast) => shown.push(toast)).pipe(provide),
    );
    await runtime.dispose();
    expect(paths).toEqual(["/api/recordings/tatort-one"]);
    expect(shown).toEqual([{ text: m.record_replaced({ title: "Tatort", start: new Date(T) }) }]);
    expect(shown[0]?.text).toContain(
      `Tatort replaced by the repeat from ${formatters().day(new Date(T))}`,
    );
  });

  it("says nothing when the repeat cannot be read", async () => {
    const { runtime, provide } = answering(404, {
      _tag: "NotFound",
      entity: "recording",
      id: "gone",
    });
    const shown: Toast[] = [];
    await runtime.runPromise(
      announceReplaced(RecordingId.make("gone"), (toast) => shown.push(toast)).pipe(provide),
    );
    await runtime.dispose();
    expect(shown).toEqual([]);
  });
});
