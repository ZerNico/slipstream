/**
 * The repeat search's person-caused transitions (recording model §3.7): deleting while looking
 * leaves an anchor without segments, "Keep the original" only brings back a replaced copy within
 * its 7 days, and declining ends a chain once.
 */
import { assert, describe, it } from "@effect/vitest";
import { DAY, isAnchor, MINUTE, type Recording, RecordingId, RuleId } from "@slipstream/domain";
import { DateTime, Effect, Layer } from "effect";
import { RecordingRepo, SegmentRepo, type StoredSegment } from "../src/ports.ts";
import { Reruns } from "../src/reruns.ts";
import { RetentionSweeper } from "../src/retention.ts";
import { at, makeHarness, recording, skyF1, T0 } from "./support.ts";

const f1 = RuleId.make("f1");

/** A failed recording of the "f1" rule `minutesAgo` back, 60 minutes long, looking for a repeat. */
const looking = (id: string, fromMinutes: number, fields: Partial<Recording> = {}): Recording =>
  recording({
    id: RecordingId.make(id),
    channelId: skyF1,
    state: "failed",
    problems: [{ _tag: "NoData" }],
    start: at(fromMinutes),
    end: at(fromMinutes + 60),
    ruleId: f1,
    rerunUntil: at(fromMinutes + 14 * 24 * 60),
    ...fields,
  });

/** A good repeat of `original`, 60 minutes from `fromMinutes`. */
const repeatOf = (id: string, original: Recording, fromMinutes: number): Recording =>
  recording({
    id: RecordingId.make(id),
    channelId: skyF1,
    state: "completed",
    start: at(fromMinutes),
    end: at(fromMinutes + 60),
    ruleId: f1,
    replacesId: original.id,
  });

const segmentAt = (fromMinutes: number, sequence: number): StoredSegment => ({
  channelId: skyF1,
  captureId: "sky-f1-capture",
  runId: "run",
  sequence,
  startMs: T0 + fromMinutes * MINUTE,
  durationMs: MINUTE,
  bytes: 1000,
  path: `${sequence}.ts`,
  directory: "/store/sky-f1",
});

const withReruns = (recordings: ReadonlyArray<Recording>) =>
  Effect.map(makeHarness({ recordings }), ({ harness, layer }) => ({
    harness,
    layer: Reruns.layer.pipe(Layer.provideMerge(layer)),
  }));

const get = (id: RecordingId) =>
  Effect.gen(function* () {
    return yield* (yield* RecordingRepo).get(id);
  });

describe("Reruns.hideAnchor", () => {
  it.effect("hides the row as an anchor and the sweep deletes its segments", () =>
    Effect.gen(function* () {
      const original = looking("original", -120);
      const { harness, layer } = yield* withReruns([original]);
      yield* Effect.gen(function* () {
        const segments = yield* SegmentRepo;
        yield* segments.add(segmentAt(-100, 1));
        yield* segments.add(segmentAt(-90, 2));
        const hidden = yield* (yield* Reruns).hideAnchor(original.id, T0);
        assert.isTrue(hidden !== undefined && isAnchor(hidden));
        // The row stays, the segments go.
        const row = yield* get(original.id);
        assert.strictEqual(row?.hiddenReason, "deleted");
        assert.strictEqual(DateTime.toEpochMillis(row!.hiddenAt!), T0);
        assert.deepStrictEqual(yield* segments.list, []);
        assert.deepStrictEqual(yield* harness.storage.removed, [
          "/store/sky-f1/1.ts",
          "/store/sky-f1/2.ts",
        ]);
        // Deleting it again keeps the moment it was first deleted.
        yield* (yield* Reruns).hideAnchor(original.id, T0 + 5 * MINUTE);
        assert.strictEqual(DateTime.toEpochMillis((yield* get(original.id))!.hiddenAt!), T0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps the segments of a copy its repeat replaced", () =>
    Effect.gen(function* () {
      const original = looking("original", -3000);
      const repeat = repeatOf("repeat", original, -200);
      const replaced: Recording = {
        ...original,
        replacedById: repeat.id,
        hiddenAt: at(-130),
        hiddenReason: "replaced",
      };
      const { layer } = yield* withReruns([replaced, repeat]);
      yield* Effect.gen(function* () {
        const segments = yield* SegmentRepo;
        yield* segments.add(segmentAt(-2990, 1));
        yield* (yield* RetentionSweeper).sweep;
        assert.deepStrictEqual(
          (yield* segments.list).map((segment) => segment.sequence),
          [1],
        );
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("Reruns.keepOriginal", () => {
  const original = looking("original", -3000);
  const repeat = repeatOf("repeat", original, -200);
  const replaced: Recording = {
    ...original,
    replacedById: repeat.id,
    hiddenAt: at(-130),
    hiddenReason: "replaced",
  };

  it.effect("brings the replaced original back and ends its chain as kept", () =>
    Effect.gen(function* () {
      const { layer } = yield* withReruns([replaced, repeat]);
      yield* Effect.gen(function* () {
        const kept = yield* (yield* Reruns).keepOriginal(repeat.id, T0);
        assert.strictEqual(kept.id, original.id);
        assert.strictEqual(kept.hiddenAt, undefined);
        assert.strictEqual(kept.hiddenReason, undefined);
        assert.strictEqual(kept.replacedById, undefined);
        assert.strictEqual(kept.rerunOutcome, "kept");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("refuses an anchor a repeat later replaced", () =>
    Effect.gen(function* () {
      const anchor: Recording = { ...replaced, hiddenReason: "deleted" };
      const { layer } = yield* withReruns([anchor, repeat]);
      yield* Effect.gen(function* () {
        const error = yield* Effect.flip((yield* Reruns).keepOriginal(repeat.id, T0));
        assert.deepStrictEqual(
          error._tag === "KeepOriginalRefused" ? error.reason : error._tag,
          "notReplaced",
        );
        assert.isTrue(isAnchor((yield* get(anchor.id))!));
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("refuses an original another repeat replaced, a non-repeat, and after 7 days", () =>
    Effect.gen(function* () {
      const other = repeatOf("other", original, -100);
      const { layer } = yield* withReruns([replaced, repeat, other]);
      yield* Effect.gen(function* () {
        const reruns = yield* Reruns;
        const reasonOf = (id: RecordingId, now: number) =>
          Effect.map(Effect.flip(reruns.keepOriginal(id, now)), (error) =>
            error._tag === "KeepOriginalRefused" ? error.reason : error._tag,
          );
        assert.strictEqual(yield* reasonOf(other.id, T0), "notReplaced");
        assert.strictEqual(yield* reasonOf(original.id, T0), "notARepeat");
        assert.strictEqual(yield* reasonOf(repeat.id, T0 + 8 * DAY), "expired");
      }).pipe(Effect.provide(layer));
    }),
  );
});

describe("Reruns.declineRerun and endChains", () => {
  it.effect("declines an open chain once and leaves an ended one alone", () =>
    Effect.gen(function* () {
      const open = looking("open", -120);
      const kept = looking("kept", -240, { rerunOutcome: "kept" });
      const { layer } = yield* withReruns([open, kept]);
      yield* Effect.gen(function* () {
        const reruns = yield* Reruns;
        assert.strictEqual((yield* reruns.declineRerun(open.id))?.rerunOutcome, "declined");
        assert.strictEqual((yield* reruns.declineRerun(kept.id))?.rerunOutcome, "kept");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("ends the open chains it is given and removes their anchors", () =>
    Effect.gen(function* () {
      const open = looking("open", -120);
      const anchor = looking("anchor", -240, { hiddenAt: at(-60), hiddenReason: "deleted" });
      const elsewhere = looking("elsewhere", -360, { ruleId: RuleId.make("other") });
      const { layer } = yield* withReruns([open, anchor, elsewhere]);
      yield* Effect.gen(function* () {
        const result = yield* (yield* Reruns).endChains([open.id, anchor.id]);
        assert.deepStrictEqual(
          result.declined.map((ended) => ended.id),
          [open.id],
        );
        assert.deepStrictEqual(result.removed, [anchor.id]);
        assert.strictEqual((yield* get(open.id))?.rerunOutcome, "declined");
        assert.strictEqual(yield* get(anchor.id), undefined);
        assert.strictEqual((yield* get(elsewhere.id))?.rerunOutcome, undefined);
      }).pipe(Effect.provide(layer));
    }),
  );
});
