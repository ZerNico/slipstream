import { DeviceCodeNotReady, Unauthorized } from "@slipstream/api";
import { DateTime, Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { describe, expect, it } from "vitest";
import {
  Api,
  isUnauthorized,
  makeApiRuntime,
  normaliseServerUrl,
  resolveServerUrl,
} from "./client.ts";

interface Captured {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly body: string | undefined;
}

/** A fetch that answers `status` and `body`, recording each request in `seen`. */
const fakeFetch = (status: number, body: unknown) => {
  const seen: Captured[] = [];
  const fetch = async (input: string | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: request.method === "GET" ? undefined : await request.text(),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    seen,
    provide: Effect.provideService(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch),
  };
};

const programme = {
  id: "p1",
  channelId: "c1",
  start: "2026-11-22T05:00:00.000Z",
  end: "2026-11-22T07:00:00.000Z",
  title: "Live F1: Rennen",
  categories: ["Sport"],
  repeat: false,
  live: true,
};

describe("Api client", () => {
  it("sends the device token and decodes guide programmes", async () => {
    const { seen, provide } = fakeFetch(200, [programme]);
    const runtime = makeApiRuntime({ baseUrl: "http://tv.local:8080", token: "secret-token" });
    const from = DateTime.makeUnsafe("2026-11-22T00:00:00.000Z");
    const to = DateTime.makeUnsafe("2026-11-23T00:00:00.000Z");
    const result = await runtime.runPromise(
      Effect.flatMap(Api, (api) => api.guide.window({ query: { from, to } })).pipe(provide),
    );
    await runtime.dispose();
    expect(result[0]?.title).toBe("Live F1: Rennen");
    expect(DateTime.toEpochMillis(result[0]?.start ?? from)).toBe(Date.UTC(2026, 10, 22, 5));
    expect(seen[0]?.authorization).toBe("Bearer secret-token");
    expect(seen[0]?.url).toBe(
      "http://tv.local:8080/api/guide?from=2026-11-22T00%3A00%3A00.000Z&to=2026-11-23T00%3A00%3A00.000Z",
    );
  });

  it("fails with the typed API error the server sent", async () => {
    const { provide } = fakeFetch(400, { _tag: "DeviceCodeNotReady", reason: "slowDown" });
    const runtime = makeApiRuntime({ baseUrl: "http://tv.local", token: undefined });
    const error = await runtime
      .runPromise(
        Effect.flatMap(Api, (api) =>
          api.auth.pollDeviceCode({ payload: { deviceCode: "dc" } }),
        ).pipe(provide),
      )
      .catch((cause: unknown) => cause);
    await runtime.dispose();
    expect(error).toBeInstanceOf(DeviceCodeNotReady);
    expect((error as DeviceCodeNotReady).reason).toBe("slowDown");
  });
});

describe("isUnauthorized", () => {
  it("recognises the server refusing a revoked or expired token", async () => {
    const { provide } = fakeFetch(401, { _tag: "Unauthorized" });
    const runtime = makeApiRuntime({ baseUrl: "http://tv.local", token: "revoked" });
    const error = await runtime
      .runPromise(Effect.flatMap(Api, (api) => api.auth.me()).pipe(provide))
      .catch((cause: unknown) => cause);
    await runtime.dispose();
    expect(error).toBeInstanceOf(Unauthorized);
    expect(isUnauthorized(error)).toBe(true);
    expect(isUnauthorized(new DeviceCodeNotReady({ reason: "pending" }))).toBe(false);
    expect(isUnauthorized(new Error("offline"))).toBe(false);
  });
});

describe("normaliseServerUrl", () => {
  it("adds http and drops trailing slashes", () => {
    expect(normaliseServerUrl(" 192.168.12.11:8080/ ")).toBe("http://192.168.12.11:8080");
    expect(normaliseServerUrl("https://tv.example.org/slipstream/")).toBe(
      "https://tv.example.org/slipstream",
    );
  });

  it("rejects what cannot be an address", () => {
    expect(normaliseServerUrl("")).toBeUndefined();
    expect(normaliseServerUrl("http://")).toBeUndefined();
    expect(normaliseServerUrl("not a host")).toBeUndefined();
  });
});

describe("resolveServerUrl", () => {
  it("resolves server paths against the origin and keeps absolute URLs", () => {
    expect(resolveServerUrl("http://tv.local:8080", "/hls/live/c1.m3u8?t=x")).toBe(
      "http://tv.local:8080/hls/live/c1.m3u8?t=x",
    );
    expect(resolveServerUrl("http://tv.local", "https://cdn.example/a.m3u8")).toBe(
      "https://cdn.example/a.m3u8",
    );
  });
});
