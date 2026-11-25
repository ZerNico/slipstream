import type { RecordingId } from "./ids.ts";
import { chainOf, isProblemRecording, type RecordingState } from "./recording.ts";
import type { RerunView } from "./rerun.ts";
import { epochMs, HOUR, type Instant } from "./time.ts";

/*
 * A damaged recording and its repeats are one chain (recording model §3.7), named by the
 * original, which every repeat's `replaces` points at. Every client's Problems list and "To do"
 * cards show one card per chain, so the reading lives here once.
 */

/** What the chain reading needs from a library entry (`RecordingEntry` in @slipstream/api). */
export interface ChainEntry {
  readonly id: RecordingId;
  readonly state: RecordingState;
  readonly start: Instant;
  readonly replacesId?: RecordingId | undefined;
  readonly replaces?:
    | {
        readonly recordingId: RecordingId;
        /** When this repeat replaced its original; set only while the original is hidden. */
        readonly replacedAt?: Instant | undefined;
      }
    | undefined;
  readonly rerun?: RerunView | undefined;
}

/**
 * One problem recording per chain, newest first: the original when the list still has it (it
 * carries the search for the repeat), else the newest damaged repeat. Chains whose original was
 * replaced are gone, so their card disappears.
 */
export const problemChains = <E extends ChainEntry>(entries: readonly E[]): readonly E[] => {
  const byChain = new Map<string, E>();
  for (const entry of entries) {
    if (!isProblemRecording(entry) || entry.rerun?.state === "replaced") continue;
    const key = chainOf(entry);
    const current = byChain.get(key);
    const original = (candidate: E) => candidate.id === key;
    if (
      current === undefined ||
      (!original(current) && (original(entry) || epochMs(entry.start) > epochMs(current.start)))
    ) {
      byChain.set(key, entry);
    }
  }
  return [...byChain.values()].toSorted((a, b) => epochMs(b.start) - epochMs(a.start));
};

/**
 * When the repeat that replaces a damaged recording airs, epoch ms: the one its rerun view
 * names, else a listed recording that replaces it and is still to come.
 */
export const scheduledRepeatStart = (
  entry: Pick<ChainEntry, "id" | "rerun">,
  entries: readonly ChainEntry[],
): number | undefined => {
  const named = entry.rerun?.repeat?.start;
  if (named !== undefined) return epochMs(named);
  const listed = entries.find(
    (candidate) =>
      candidate.replaces?.recordingId === entry.id &&
      (candidate.state === "scheduled" || candidate.state === "recording"),
  );
  return listed === undefined ? undefined : epochMs(listed.start);
};

/** How long the "replaced by the repeat" card stays after the repeat replaced its original. */
export const replacedCardMillis = 24 * HOUR;

/** A repeat that replaced the damaged recording of its chain, for the short-lived ok card. */
export interface ReplacedChain<E extends ChainEntry = ChainEntry> {
  /** `replaced:<original id>`: one per chain, the key dismissing it remembers. */
  readonly key: string;
  /** The repeat, which took the original's place. */
  readonly repeat: E;
}

/**
 * Repeats that replaced their original within the last 24 hours (§3.7 "where people learn about
 * it"): the server says so with `replaces.replacedAt`, set only while the original is hidden as
 * replaced by this repeat. After "Keep the original" it is gone, and so is the card. Newest first.
 */
export const replacedChains = <E extends ChainEntry>(
  entries: readonly E[],
  now: number,
): readonly ReplacedChain<E>[] =>
  entries
    .flatMap((entry): ReplacedChain<E>[] => {
      const replacedAt = entry.replaces?.replacedAt;
      if (entry.replaces === undefined || replacedAt === undefined) return [];
      const since = now - epochMs(replacedAt);
      return since >= 0 && since < replacedCardMillis
        ? [{ key: `replaced:${entry.replaces.recordingId}`, repeat: entry }]
        : [];
    })
    .toSorted((a, b) => epochMs(b.repeat.start) - epochMs(a.repeat.start));
