import { CollectionOffer, RuleId } from "@slipstream/domain";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { describe, expect, it } from "vitest";
import type { Api } from "../api/client.ts";
import { makeApiRuntime } from "../api/client.ts";
import { offerAfterCreate, offerStepActions, type OfferStep, seriesUndo } from "./offer-step.ts";

const offer = Schema.decodeUnknownSync(CollectionOffer)({
  name: "Live F1",
  layout: { parts: [], path: ["{year}", "{programme}"] },
  groups: 3,
  examples: ["Live F1: Qualifying - GP Katar", "Live F1: Rennen - GP Katar"],
});

const collection = {
  id: "formel-1",
  name: "Live F1",
  rank: 0,
  labels: [],
  layout: { parts: [], path: ["{year}", "{programme}"] },
  matcher: {
    channels: ["f1"],
    title: [{ _tag: "StartsWith", values: ["Live F1:"] }],
    categories: [],
    weekdays: [],
  },
};

/**
 * A server that answers each request from `answers` by method and path, and remembers every
 * request it saw ("POST /api/rules/f1/collection").
 */
const fakeServer = (
  answers: Record<string, { readonly status: number; readonly body?: unknown }>,
) => {
  const seen: string[] = [];
  // Each request's query string ("?undo=true"), in the same order as `seen`.
  const searches: string[] = [];
  const runtime = makeApiRuntime({ baseUrl: "http://tv.local", token: "token" });
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (input instanceof Request ? input.method : init?.method) ?? "GET";
    const request = `${method} ${url.pathname}`;
    seen.push(request);
    searches.push(url.search);
    const answer = answers[request] ?? { status: 404, body: { _tag: "NotFound" } };
    return Promise.resolve(
      new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const run = <A, E>(effect: Effect.Effect<A, E, Api>): Promise<A> =>
    runtime.runPromise(effect.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)));
  return { run, seen, searches, dispose: () => runtime.dispose() };
};

const step: OfferStep = { ruleId: RuleId.make("f1"), offer };

/** The step's handlers, counting closes and keeping the Undo it was given. */
const handlers = (run: ReturnType<typeof fakeServer>["run"]) => {
  const state = {
    closed: 0,
    failed: 0,
    grouped: undefined as string | undefined,
    undo: undefined as (() => Promise<void>) | undefined,
  };
  return {
    state,
    handlers: {
      run,
      close: () => {
        state.closed += 1;
      },
      grouped: (name: string, undo: () => Promise<void>) => {
        state.grouped = name;
        state.undo = undo;
      },
      failed: () => {
        state.failed += 1;
      },
    },
  };
};

describe("offerAfterCreate", () => {
  it("asks the server for the new series recording's offer", async () => {
    const server = fakeServer({ "GET /api/rules/f1/offer": { status: 200, body: { offer } } });
    await expect(server.run(offerAfterCreate(RuleId.make("f1")))).resolves.toEqual(step);
    expect(server.seen).toEqual(["GET /api/rules/f1/offer"]);
    await server.dispose();
  });

  it("offers nothing when the programmes do not scatter or the check fails", async () => {
    const none = fakeServer({ "GET /api/rules/f1/offer": { status: 200, body: {} } });
    await expect(none.run(offerAfterCreate(RuleId.make("f1")))).resolves.toBeUndefined();
    await none.dispose();
    const broken = fakeServer({});
    await expect(broken.run(offerAfterCreate(RuleId.make("f1")))).resolves.toBeUndefined();
    await broken.dispose();
  });
});

describe("seriesUndo", () => {
  it("deletes the series recording just created with undo, so its schedule goes too", async () => {
    const server = fakeServer({ "DELETE /api/rules/f1": { status: 204 } });
    await seriesUndo(RuleId.make("f1"), server.run)();
    expect(server.seen).toEqual(["DELETE /api/rules/f1"]);
    expect(server.searches).toEqual(["?undo=true"]);
    await server.dispose();
  });
});

describe("offerStepActions", () => {
  it("Not now only closes the step and never declines the offer", async () => {
    const server = fakeServer({});
    const { state, handlers: h } = handlers(server.run);
    offerStepActions(step, h).notNow();
    expect(state.closed).toBe(1);
    expect(server.seen).toEqual([]);
    await server.dispose();
  });

  it("Group them creates the linked collection, and Undo takes it away again", async () => {
    const server = fakeServer({
      "POST /api/rules/f1/collection": { status: 200, body: collection },
      "DELETE /api/rules/f1/collection": { status: 204 },
    });
    const { state, handlers: h } = handlers(server.run);
    await offerStepActions(step, h).groupThem();
    expect(server.seen).toEqual(["POST /api/rules/f1/collection"]);
    // The sheet decides where Undo lives (a focused row on TV), so the step does not close.
    expect(state.closed).toBe(0);
    expect(state.grouped).toBe("Live F1");
    await state.undo?.();
    expect(server.seen).toEqual([
      "POST /api/rules/f1/collection",
      "DELETE /api/rules/f1/collection",
    ]);
    expect(server.seen.some((request) => request.includes("decline"))).toBe(false);
    expect(state.failed).toBe(0);
    await server.dispose();
  });

  it("keeps the step open when grouping fails", async () => {
    const server = fakeServer({
      "POST /api/rules/f1/collection": { status: 403, body: { _tag: "Forbidden" } },
    });
    const { state, handlers: h } = handlers(server.run);
    await offerStepActions(step, h).groupThem();
    expect(state.failed).toBe(1);
    expect(state.closed).toBe(0);
    expect(state.grouped).toBeUndefined();
    await server.dispose();
  });
});
