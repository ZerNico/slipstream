import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { FaultControl, noFaults, StreamFaultsQuery } from "./faults.ts";

const decodeQuery = Schema.decodeUnknownEffect(StreamFaultsQuery);

describe("StreamFaultsQuery", () => {
  it.effect("decodes refusals, delays and modes from query strings", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* decodeQuery({ refuse: "429", dropAfter: "2.5", dropMode: "eof" }),
        {
          refuse: 429,
          dropAfter: 2.5,
          dropMode: "eof",
        },
      );
      assert.deepStrictEqual(yield* decodeQuery({ refuse: "eof", stallAfter: "0" }), {
        refuse: "eof",
        stallAfter: 0,
      });
    }),
  );

  it.effect("rejects statuses that are not errors and negative delays", () =>
    Effect.gen(function* () {
      for (const bad of [
        { refuse: "200" },
        { refuse: "teapot" },
        { dropAfter: "-1" },
        { dropMode: "x" },
      ]) {
        const result = yield* Effect.result(decodeQuery(bad));
        assert.strictEqual(result._tag, "Failure", JSON.stringify(bad));
      }
    }),
  );
});

describe("FaultControl", () => {
  const provide = Effect.provide(FaultControl.layer(noFaults));

  it.effect("lets query faults win over source-wide ones", () =>
    Effect.gen(function* () {
      const faults = yield* FaultControl;
      yield* faults.update({ dropAfter: 10, refuse: 403 });
      const plan = yield* faults.plan({ dropAfter: 2, refuse: "eof" });
      assert.deepStrictEqual(plan, {
        refuse: "eof",
        dropAfter: 2,
        dropMode: "reset",
        stallAfter: null,
      });
      assert.deepStrictEqual(yield* faults.plan({}), {
        refuse: 403,
        dropAfter: 10,
        dropMode: "reset",
        stallAfter: null,
      });
    }).pipe(provide),
  );

  it.effect("refuses only the counted number of requests, then recovers", () =>
    Effect.gen(function* () {
      const faults = yield* FaultControl;
      yield* faults.update({ refuse: 429, refuseCount: 2 });
      const refusals = [];
      for (let attempt = 0; attempt < 4; attempt++) refusals.push((yield* faults.plan({})).refuse);
      assert.deepStrictEqual(refusals, [429, 429, null, null]);
      const state = yield* faults.state;
      assert.strictEqual(state.refuse, null);
      assert.strictEqual(state.refuseCount, null);
    }).pipe(provide),
  );

  it.effect("clears settings with null and resets to the initial state", () =>
    Effect.gen(function* () {
      const faults = yield* FaultControl;
      yield* faults.update({ maxStreams: 2, stallAfter: 3, limitStatus: 403 });
      const cleared = yield* faults.update({ stallAfter: null });
      assert.strictEqual(cleared.stallAfter, null);
      assert.strictEqual(cleared.maxStreams, 2);
      assert.strictEqual(cleared.limitStatus, 403);
      assert.deepStrictEqual(yield* faults.reset, noFaults);
    }).pipe(provide),
  );
});
