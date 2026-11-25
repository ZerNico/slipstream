/**
 * Retention with repeat chains and history (recording model §3.6, §5.4): chains still looking
 * stay, a chain counts once, hidden recordings are purged on their own schedule, and deleting
 * good episodes of a series recording writes history.
 */
import { assert, describe, it } from "@effect/vitest";
import { DAY, MINUTE, type Recording, RecordingId, RuleId } from "@slipstream/domain";
import { DateTime, Effect } from "effect";
import { RecordingRepo } from "../src/ports.ts";
import {
  expiredRecordings,
  hiddenRetentionMs,
  purgedHidden,
  RetentionSweeper,
  type RetentionGroup,
} from "../src/retention.ts";
import { alice, at, bob, daserste, makeHarness, recording, rule, T0 } from "./support.ts";

const DAY_MINUTES = 24 * 60;
const tatortRule = RuleId.make("tatort");

/** A Tatort recording of the series recording `daysAgo` days back, 90 minutes long. */
const episode = (id: string, daysAgo: number, fields: Partial<Recording> = {}): Recording =>
  recording({
    id: RecordingId.make(id),
    channelId: daserste,
    title: "Tatort",
    subtitle: `Folge ${id}`,
    episode: { episode: 1000 + daysAgo },
    state: "completed",
    start: at(-daysAgo * DAY_MINUTES),
    end: at(-daysAgo * DAY_MINUTES + 90),
    ruleId: tatortRule,
    ...fields,
  });

/** A failed recording of the series recording, looking for its repeat until `untilMinutes`. */
const looking = (id: string, daysAgo: number, untilMinutes: number) =>
  episode(id, daysAgo, {
    state: "failed",
    problems: [{ _tag: "NoData" }],
    rerunUntil: at(untilMinutes),
  });

const group = (
  retention: RetentionGroup["retention"],
  members: ReadonlyArray<Recording>,
): RetentionGroup => ({
  id: "rule:tatort",
  retention,
  recordingIds: members.map((member) => member.id),
});

const sorted = (ids: Iterable<string>) => [...ids].toSorted();

describe("retention with repeat chains", () => {
  it("never deletes a chain that is still looking for its repeat", () => {
    const searching = looking("searching", 5, 60);
    const givenUp = looking("given-up", 6, -60);
    const all = [searching, givenUp];
    const expired = expiredRecordings(all, [group({ _tag: "KeepDays", days: 1 }, all)], T0);
    assert.deepStrictEqual(sorted(expired), ["given-up"]);
  });

  it("never deletes a chain whose repeat is scheduled", () => {
    const original = looking("original", 5, -60);
    const repeat = episode("repeat", -1, {
      state: "scheduled",
      replacesId: original.id,
      start: at(60),
      end: at(150),
    });
    const all = [original, repeat];
    const expired = expiredRecordings(all, [group({ _tag: "KeepDays", days: 1 }, all)], T0);
    assert.deepStrictEqual(sorted(expired), []);
  });

  it("counts a damaged original and its repeat as one episode for KeepNewest", () => {
    const newest = episode("newest", 1);
    const original = episode("original", 5, {
      state: "incomplete",
      problems: [
        { _tag: "Gap", range: { start: at(-5 * DAY_MINUTES), end: at(-5 * DAY_MINUTES + 30) } },
      ],
      rerunUntil: at(9 * DAY_MINUTES),
      rerunOutcome: "kept",
    });
    const repeat = episode("repeat", 3, { replacesId: original.id });
    const oldest = episode("oldest", 8);
    const all = [newest, original, repeat, oldest];
    const expired = expiredRecordings(all, [group({ _tag: "KeepNewest", count: 2 }, all)], T0);
    // newest, then the chain (original and repeat share one slot); the oldest goes.
    assert.deepStrictEqual(sorted(expired), ["oldest"]);
  });

  it("does not count hidden recordings, nor delete them by policy", () => {
    const repeat = episode("repeat", 2);
    const hidden = episode("hidden", 3, {
      state: "failed",
      problems: [{ _tag: "NoData" }],
      replacedById: repeat.id,
      hiddenAt: at(-2 * DAY_MINUTES + 100),
      hiddenReason: "replaced",
    });
    const other = episode("other", 4);
    const all = [repeat, hidden, other];
    const expired = expiredRecordings(all, [group({ _tag: "KeepNewest", count: 2 }, all)], T0);
    assert.deepStrictEqual(sorted(expired), []);
  });
});

describe("purging hidden recordings", () => {
  const repeat = episode("repeat", 1);
  /** Replaced by `repeat`, hidden when the repeat finished. */
  const replaced = () =>
    episode("replaced", 2, {
      state: "failed",
      problems: [{ _tag: "NoData" }],
      replacedById: repeat.id,
      hiddenAt: DateTime.makeUnsafe(DateTime.toEpochMillis(repeat.end) + 5 * MINUTE),
      hiddenReason: "replaced",
    });

  it("purges a replaced recording 7 days after it was hidden", () => {
    const hidden = replaced();
    const hiddenMs = DateTime.toEpochMillis(hidden.hiddenAt!);
    assert.deepStrictEqual(sorted(purgedHidden([repeat, hidden], hiddenMs + DAY)), []);
    assert.deepStrictEqual(sorted(purgedHidden([repeat, hidden], hiddenMs + hiddenRetentionMs)), [
      hidden.id,
    ]);
  });

  it("purges an anchor deleted while looking as soon as its chain ends", () => {
    // Deleted by a person while the chain looked: hidden, no replacement yet.
    const anchor = looking("anchor", 3, 60);
    const hidden = { ...anchor, hiddenAt: at(-60), hiddenReason: "deleted" as const };
    assert.deepStrictEqual(sorted(purgedHidden([hidden], T0)), []);
    // Looking ends (the deadline passed): exhausted, purged at once.
    assert.deepStrictEqual(sorted(purgedHidden([hidden], T0 + 2 * 60 * MINUTE)), [anchor.id]);
    // Declined, or replaced by a repeat that ended after it was hidden: purged at once too.
    assert.deepStrictEqual(sorted(purgedHidden([{ ...hidden, rerunOutcome: "declined" }], T0)), [
      anchor.id,
    ]);
    const later = episode("later", -1, { start: at(-50), end: at(-10), replacesId: anchor.id });
    assert.deepStrictEqual(
      sorted(purgedHidden([{ ...hidden, replacedById: later.id }, later], T0)),
      [anchor.id],
    );
  });

  it("keeps a replaced copy its 7 days, however early it was hidden", () => {
    // Hidden before its repeat's padded end: still a replaced copy, not an anchor.
    const early = { ...replaced(), hiddenAt: at(-2 * DAY_MINUTES) };
    assert.deepStrictEqual(sorted(purgedHidden([repeat, early], T0)), []);
  });

  it("never purges a protected recording", () => {
    const hidden = { ...replaced(), protected: true };
    assert.deepStrictEqual(sorted(purgedHidden([repeat, hidden], T0 + 30 * DAY)), []);
  });
});

describe("history written by retention (§3.6)", () => {
  it.effect(
    "writes history for each owner of a good deleted episode, never for a damaged one",
    () =>
      Effect.gen(function* () {
        const series = rule(
          "tatort",
          { channels: [daserste] },
          { skipRepeats: true, retention: { _tag: "KeepNewest", count: 1 } },
        );
        const newest = episode("newest", 1);
        const good = episode("good", 8, { ownerIds: [alice, bob] });
        const broken = episode("broken", 15, { state: "failed", problems: [{ _tag: "NoData" }] });
        const { harness, layer } = yield* makeHarness({
          rules: [series],
          recordings: [newest, good, broken],
        });
        yield* Effect.gen(function* () {
          const report = yield* (yield* RetentionSweeper).sweep;
          assert.deepStrictEqual(sorted(report.recordingIds), ["broken", "good"]);
          const entries = yield* harness.history.entries;
          assert.deepStrictEqual(
            entries.map((entry) => [entry.userId, entry.ruleId, entry.showKey, entry.episode]),
            [
              [alice, series.id, "tatort", 1008],
              [bob, series.id, "tatort", 1008],
            ],
          );
          assert.deepStrictEqual(
            (yield* (yield* RecordingRepo).list).map((item) => item.id),
            [newest.id],
          );
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("writes no history for a series recording that records every airing", () =>
    Effect.gen(function* () {
      const series = rule(
        "tatort",
        { channels: [daserste] },
        { skipRepeats: false, retention: { _tag: "KeepNewest", count: 1 } },
      );
      const { harness, layer } = yield* makeHarness({
        rules: [series],
        recordings: [episode("newest", 1), episode("older", 8)],
      });
      yield* Effect.gen(function* () {
        const report = yield* (yield* RetentionSweeper).sweep;
        assert.deepStrictEqual(sorted(report.recordingIds), ["older"]);
        assert.deepStrictEqual(yield* harness.history.entries, []);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("purges a hidden recording with the sweep, without history", () =>
    Effect.gen(function* () {
      const series = rule("tatort", { channels: [daserste] }, { skipRepeats: true });
      const repeat = episode("repeat", 9);
      const hidden = episode("hidden", 10, {
        replacedById: repeat.id,
        state: "failed",
        problems: [{ _tag: "NoData" }],
        hiddenAt: at(-8 * DAY_MINUTES),
        hiddenReason: "replaced",
      });
      const { harness, layer } = yield* makeHarness({
        rules: [series],
        recordings: [repeat, hidden],
      });
      yield* Effect.gen(function* () {
        const report = yield* (yield* RetentionSweeper).sweep;
        assert.deepStrictEqual(report.recordingIds, [hidden.id]);
        assert.deepStrictEqual(yield* harness.history.entries, []);
      }).pipe(Effect.provide(layer));
    }),
  );
});
