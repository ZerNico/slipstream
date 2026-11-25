import { Deferred, Effect, Fiber } from "effect";
import { FetchHttpClient } from "effect/http";
import { describe, expect, it } from "@effect/vitest";
import { makeApiRuntime } from "../api/client.ts";
import { revokeToken } from "./sign-out.ts";

const connection = { baseUrl: "http://tv.local:8080", token: "device-token" };

/** A fetch on a device without a network. */
const offline = () => Promise.reject(new TypeError("Network request failed"));

describe("revokeToken", () => {
  it.effect("completes the logout request after the session runtime is disposed", () =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<void>();
      const seen: { url: string; method: string; authorization: string | null }[] = [];
      let answered = false;
      const fetch = async (input: string | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        seen.push({
          url: request.url,
          method: request.method,
          authorization: request.headers.get("authorization"),
        });
        await Effect.runPromise(Deferred.await(answer));
        answered = true;
        return new Response(null, { status: 204 });
      };
      // What signing out does: start the request, then drop the profile's runtime at once.
      const runtime = makeApiRuntime(connection);
      const fiber = yield* revokeToken(connection).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch),
        Effect.forkDetach,
      );
      yield* Effect.promise(() => runtime.dispose());
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
      yield* Deferred.succeed(answer, undefined);
      yield* Fiber.join(fiber);
      expect(answered).toBe(true);
      expect(seen).toEqual([
        {
          url: "http://tv.local:8080/api/auth/logout",
          method: "POST",
          authorization: "Bearer device-token",
        },
      ]);
    }),
  );

  it.effect("gives up quietly when the server cannot be reached", () =>
    Effect.gen(function* () {
      yield* revokeToken(connection).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, offline as typeof globalThis.fetch),
      );
    }),
  );
});
