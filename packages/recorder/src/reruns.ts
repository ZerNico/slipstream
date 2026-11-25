/**
 * The repeat search's state changes people cause (recording model §3.7): stopping a chain's
 * search, deleting a damaged original while its chain still looks (it stays as the chain's
 * anchor), taking back a replacement ("Keep the original"), and ending every chain of a rule
 * that goes away. The scheduler makes the automatic ones (a repeat replaced its original, a
 * failed attempt, the deadline); this service is the only other writer of `hiddenAt`,
 * `hiddenReason`, `replacedById` and `rerunOutcome`.
 */
import { isAnchor, type Recording, RecordingId } from "@slipstream/domain";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { RecordingRepo, type StoredRecording } from "./ports.ts";
import { hiddenRetentionMs, RetentionSweeper } from "./retention.ts";

/** Why "Keep the original" was refused. */
export const KeepOriginalReason = Schema.Literals([
  /** The recording is no repeat, or its original is gone. */
  "notARepeat",
  /**
   * The original was not replaced by this repeat, or it is an anchor (deleted by a person while
   * its chain looked for a repeat): there is nothing to bring back.
   */
  "notReplaced",
  /** The original was replaced longer than the hidden retention (7 days) ago. */
  "expired",
]);
export type KeepOriginalReason = typeof KeepOriginalReason.Type;

/** "Keep the original" cannot bring the original back. */
export class KeepOriginalRefused extends Schema.TaggedError<KeepOriginalRefused>()(
  "KeepOriginalRefused",
  { repeatId: RecordingId, reason: KeepOriginalReason },
) {}

/** No recording with this id (the repeat asked to keep its original). */
export class RerunRecordingNotFound extends Schema.TaggedError<RerunRecordingNotFound>()(
  "RerunRecordingNotFound",
  { recordingId: RecordingId },
) {}

/** Whether a chain's search may still end: nothing replaced the original and no outcome yet. */
const searchOpen = (original: Pick<Recording, "replacedById" | "rerunOutcome">) =>
  original.replacedById === undefined && original.rerunOutcome === undefined;

/** Until when "Keep the original" works for an original hidden at `hiddenAt` (epoch ms). */
export const keepOriginalUntil = (hiddenAtMs: number): number => hiddenAtMs + hiddenRetentionMs;

const makeReruns = Effect.gen(function* () {
  const repo = yield* RecordingRepo;
  const sweeper = yield* RetentionSweeper;

  /** "Skip this one" or "stop looking": the chain of `originalId` stops looking for good. */
  const declineRerun = (originalId: RecordingId) =>
    repo.update(originalId, (current) =>
      searchOpen(current) ? { ...current, rerunOutcome: "declined" } : current,
    );

  const hideAnchor = (id: RecordingId, now: number) =>
    Effect.gen(function* () {
      const hidden = yield* repo.update(id, (current) =>
        isAnchor(current)
          ? current
          : { ...current, hiddenAt: DateTime.makeUnsafe(now), hiddenReason: "deleted" },
      );
      if (hidden !== undefined) yield* sweeper.sweep;
      return hidden;
    });

  const keepOriginal = (repeatId: RecordingId, now: number) =>
    Effect.gen(function* () {
      const repeat = yield* repo.get(repeatId);
      if (repeat === undefined) {
        return yield* new RerunRecordingNotFound({ recordingId: repeatId });
      }
      const refuse = (reason: KeepOriginalReason) => new KeepOriginalRefused({ repeatId, reason });
      if (repeat.replacesId === undefined) return yield* refuse("notARepeat");
      const original = yield* repo.get(repeat.replacesId);
      if (original === undefined) return yield* refuse("notARepeat");
      if (
        isAnchor(original) ||
        original.hiddenAt === undefined ||
        original.replacedById !== repeat.id
      ) {
        return yield* refuse("notReplaced");
      }
      if (now > keepOriginalUntil(DateTime.toEpochMillis(original.hiddenAt))) {
        return yield* refuse("expired");
      }
      const kept = yield* repo.update(original.id, (current): StoredRecording => {
        const {
          hiddenAt: _hiddenAt,
          hiddenReason: _hiddenReason,
          replacedById: _replacedById,
          ...rest
        } = current;
        return { ...rest, rerunOutcome: "kept" };
      });
      if (kept === undefined) return yield* refuse("notARepeat");
      return kept;
    });

  const endChains = (originalIds: ReadonlyArray<RecordingId>) =>
    Effect.gen(function* () {
      const declined: Array<StoredRecording> = [];
      const removed: Array<RecordingId> = [];
      for (const id of new Set(originalIds)) {
        const original = yield* repo.get(id);
        if (original === undefined) continue;
        // Anchors only held their chain's search; with the chain ended nobody sees them again.
        if (isAnchor(original) && original.replacedById === undefined) {
          yield* repo.remove(original.id);
          removed.push(original.id);
          continue;
        }
        if (
          original.replacesId !== undefined ||
          original.rerunUntil === undefined ||
          !searchOpen(original)
        ) {
          continue;
        }
        const ended = yield* declineRerun(original.id);
        if (ended !== undefined) declined.push(ended);
      }
      return { declined, removed };
    });

  return Reruns.of({ declineRerun, hideAnchor, keepOriginal, endChains });
});

/** The repeat search's person-caused transitions (§3.7). */
export class Reruns extends Context.Service<
  Reruns,
  {
    /**
     * Ends the chain of `originalId` as `declined`, unless it already ended (replaced, kept,
     * declined or exhausted). Returns the original, or `undefined` when the id is unknown.
     */
    declineRerun(originalId: RecordingId): Effect.Effect<StoredRecording | undefined>;
    /**
     * Hides a damaged original deleted while its chain looks for a repeat: `hiddenAt` (kept
     * when it is an anchor already) and `hiddenReason: "deleted"`. The sweep that follows
     * deletes its segments; the row stays as the chain's anchor until the chain ends. Returns
     * the anchor, or `undefined` when the id is unknown.
     */
    hideAnchor(id: RecordingId, now: number): Effect.Effect<StoredRecording | undefined>;
    /**
     * "Keep the original" on the repeat `repeatId` (§3.7 step 3): within 7 days of the
     * replacement, the original comes back and its chain ends as `kept`. Refused for an anchor,
     * an original this repeat did not replace, and after the 7 days.
     */
    keepOriginal(
      repeatId: RecordingId,
      now: number,
    ): Effect.Effect<StoredRecording, KeepOriginalRefused | RerunRecordingNotFound>;
    /**
     * A rule goes away: the chains of `originalIds` (the rule's recordings, read before the rule
     * was deleted) that still look for a repeat end as `declined`, and their anchors are
     * removed. Ids that are no original with an open search, or are gone, are skipped.
     */
    endChains(originalIds: ReadonlyArray<RecordingId>): Effect.Effect<{
      readonly declined: ReadonlyArray<StoredRecording>;
      readonly removed: ReadonlyArray<RecordingId>;
    }>;
  }
>()("@slipstream/recorder/Reruns") {
  /** Over the recording repository, sweeping with the retention sweeper. */
  static readonly layer = Layer.effect(Reruns, makeReruns);
}
